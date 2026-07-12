(function initializeCielSync() {
  const META_KEY = "ciel-sync-meta-v1";
  const config = window.CIEL_SYNC_CONFIG || {};
  const app = window.CielApp;
  const supabaseGlobal = window.supabase;

  let client = null;
  let user = null;
  let knownVersion = null;
  let pushTimer = null;
  let applyingRemote = false;
  let conflictResolver = null;

  const meta = loadMeta();

  function loadMeta() {
    try {
      return {
        localUpdatedAt: null,
        lastSyncedAt: null,
        lastVersion: null,
        ...(JSON.parse(localStorage.getItem(META_KEY)) || {}),
      };
    } catch {
      return { localUpdatedAt: null, lastSyncedAt: null, lastVersion: null };
    }
  }

  function saveMeta() {
    localStorage.setItem(META_KEY, JSON.stringify(meta));
  }

  function setStatus(status, detail) {
    const button = document.querySelector("#syncButton");
    const label = document.querySelector("#syncButtonLabel");
    const detailStatus = document.querySelector("#syncDetailStatus");
    if (!button || !label) return;
    button.classList.remove("is-local", "is-synced", "is-syncing", "is-error");
    button.classList.add(`is-${status}`);
    const labels = {
      local: "仅本机",
      synced: "已同步",
      syncing: "同步中",
      error: "同步失败",
    };
    label.textContent = labels[status] || labels.local;
    if (detailStatus) detailStatus.textContent = detail || labels[status] || labels.local;
  }

  function formatSyncTime(value) {
    if (!value) return "—";
    const date = new Date(value);
    return new Intl.DateTimeFormat("zh-CN", {
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
  }

  function updateSyncTime() {
    const node = document.querySelector("#syncLastTime");
    if (node) node.textContent = formatSyncTime(meta.lastSyncedAt);
  }

  function isConfigured() {
    return Boolean(config.supabaseUrl && config.supabaseAnonKey && supabaseGlobal?.createClient);
  }

  function isPayloadEmpty(payload) {
    return app.isStateEmpty(payload || {});
  }

  function payloadsMatch(left, right) {
    return JSON.stringify(left || {}) === JSON.stringify(right || {});
  }

  function markSynced(remote) {
    knownVersion = remote.version;
    meta.lastVersion = remote.version;
    meta.lastSyncedAt = remote.updated_at;
    meta.localUpdatedAt = remote.updated_at;
    saveMeta();
    updateSyncTime();
    setStatus("synced", "已同步");
  }

  async function fetchRemote() {
    const { data, error } = await client
      .from("user_state")
      .select("payload, version, updated_at")
      .eq("user_id", user.id)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async function createRemote(payload) {
    const now = new Date().toISOString();
    const { data, error } = await client
      .from("user_state")
      .insert({ user_id: user.id, payload, version: 1, updated_at: now })
      .select("payload, version, updated_at")
      .single();
    if (error) throw error;
    markSynced(data);
  }

  async function forceRemote(payload, versionBase) {
    const now = new Date().toISOString();
    const nextVersion = Number(versionBase || 0) + 1;
    const { data, error } = await client
      .from("user_state")
      .upsert({ user_id: user.id, payload, version: nextVersion, updated_at: now })
      .select("payload, version, updated_at")
      .single();
    if (error) throw error;
    markSynced(data);
  }

  async function pushLocal() {
    if (!client || !user || applyingRemote) return;
    clearTimeout(pushTimer);
    setStatus("syncing", "正在上传");
    try {
      const remote = await fetchRemote();
      if (!remote) {
        await createRemote(app.getState());
        return;
      }
      if (knownVersion == null) knownVersion = remote.version;
      if (remote.version !== knownVersion) {
        await resolveRemoteConflict(remote);
        return;
      }

      const now = new Date().toISOString();
      const nextVersion = Number(knownVersion) + 1;
      const { data, error } = await client
        .from("user_state")
        .update({ payload: app.getState(), version: nextVersion, updated_at: now })
        .eq("user_id", user.id)
        .eq("version", knownVersion)
        .select("payload, version, updated_at")
        .maybeSingle();
      if (error) throw error;
      if (!data) {
        const latest = await fetchRemote();
        await resolveRemoteConflict(latest);
        return;
      }
      markSynced(data);
    } catch (error) {
      console.error("Ciel sync upload failed", error);
      setStatus("error", "上传失败，本机数据仍已保存");
      showAccountMessage("暂时无法连接云端，本机数据没有丢失。", true);
    }
  }

  async function applyCloud(remote) {
    applyingRemote = true;
    app.replaceStateFromSync(remote.payload || {});
    applyingRemote = false;
    markSynced(remote);
  }

  async function resolveRemoteConflict(remote) {
    if (!remote) {
      await createRemote(app.getState());
      return;
    }
    const choice = await askConflict(remote);
    if (choice === "cloud") {
      await applyCloud(remote);
    } else {
      await forceRemote(app.getState(), remote.version);
    }
  }

  async function syncNow() {
    if (!client || !user) return;
    clearTimeout(pushTimer);
    setStatus("syncing", "正在检查云端");
    showAccountMessage("");
    try {
      const remote = await fetchRemote();
      const local = app.getState();
      if (!remote) {
        await createRemote(local);
        showAccountMessage("这台设备的数据已经上传。", false);
        return;
      }
      if (payloadsMatch(local, remote.payload)) {
        markSynced(remote);
        return;
      }

      const firstSync = meta.lastVersion == null;
      if (firstSync) {
        if (isPayloadEmpty(local)) {
          await applyCloud(remote);
        } else if (isPayloadEmpty(remote.payload)) {
          await forceRemote(local, remote.version);
        } else {
          await resolveRemoteConflict(remote);
        }
        return;
      }

      knownVersion = meta.lastVersion;
      const remoteChanged = remote.version !== meta.lastVersion;
      const localChanged = Boolean(meta.localUpdatedAt && meta.localUpdatedAt !== meta.lastSyncedAt);
      if (remoteChanged && localChanged) {
        await resolveRemoteConflict(remote);
      } else if (remoteChanged) {
        await applyCloud(remote);
      } else if (localChanged) {
        await pushLocal();
      } else {
        await resolveRemoteConflict(remote);
      }
    } catch (error) {
      console.error("Ciel sync failed", error);
      setStatus("error", "同步失败，本机数据仍已保存");
      showAccountMessage("暂时无法连接云端，请稍后重试。", true);
    }
  }

  function askConflict(remote) {
    const dialog = document.querySelector("#syncConflictDialog");
    const cloudSummary = document.querySelector("#cloudConflictSummary");
    const localSummary = document.querySelector("#localConflictSummary");
    cloudSummary.textContent = `云端更新于 ${formatSyncTime(remote.updated_at)}`;
    localSummary.textContent = `本机更新于 ${formatSyncTime(meta.localUpdatedAt)}`;
    dialog.showModal();
    return new Promise((resolve) => { conflictResolver = resolve; });
  }

  function resolveConflict(choice) {
    document.querySelector("#syncConflictDialog")?.close();
    conflictResolver?.(choice);
    conflictResolver = null;
  }

  function notifyLocalChange() {
    if (applyingRemote) return;
    meta.localUpdatedAt = new Date().toISOString();
    saveMeta();
    if (!user) {
      setStatus("local", "仅保存在这台设备");
      return;
    }
    setStatus("syncing", "等待上传");
    clearTimeout(pushTimer);
    pushTimer = setTimeout(pushLocal, 900);
  }

  function renderAuth(session) {
    user = session?.user || null;
    document.querySelector("#syncSignedOut")?.classList.toggle("is-hidden", Boolean(user));
    document.querySelector("#syncSignedIn")?.classList.toggle("is-hidden", !user);
    if (user) {
      document.querySelector("#syncEmail").textContent = user.email || "已登录";
      setStatus("syncing", "正在连接");
      syncNow();
    } else {
      knownVersion = null;
      setStatus("local", "仅保存在这台设备");
    }
    updateSyncTime();
  }

  function showAccountMessage(message, isError = false) {
    const node = document.querySelector("#syncAccountMessage");
    if (!node) return;
    node.textContent = message;
    node.style.color = isError ? "#a33d38" : "";
  }

  async function sendMagicLink(event) {
    event.preventDefault();
    const message = document.querySelector("#syncLoginMessage");
    const email = new FormData(event.currentTarget).get("email").trim();
    message.textContent = "正在发送……";
    const redirectTo = `${window.location.origin}${window.location.pathname}`;
    const { error } = await client.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: redirectTo },
    });
    message.textContent = error ? `发送失败：${error.message}` : "登录链接已发送，请打开邮箱完成登录。";
  }

  async function signOut() {
    await client.auth.signOut();
    renderAuth(null);
    document.querySelector("#syncDialog")?.close();
  }

  function bindUI() {
    document.querySelector("#syncButton")?.addEventListener("click", () => document.querySelector("#syncDialog")?.showModal());
    document.querySelector("#closeSyncDialog")?.addEventListener("click", () => document.querySelector("#syncDialog")?.close());
    document.querySelector("#syncLoginForm")?.addEventListener("submit", sendMagicLink);
    document.querySelector("#syncNowButton")?.addEventListener("click", syncNow);
    document.querySelector("#signOutButton")?.addEventListener("click", signOut);
    document.querySelector("#keepCloudButton")?.addEventListener("click", () => resolveConflict("cloud"));
    document.querySelector("#keepLocalButton")?.addEventListener("click", () => resolveConflict("local"));
    window.addEventListener("focus", () => { if (user) syncNow(); });
    window.addEventListener("online", () => { if (user) syncNow(); });
  }

  async function init() {
    bindUI();
    if (!isConfigured()) {
      setStatus("local", "云端同步尚未配置");
      return;
    }
    client = supabaseGlobal.createClient(config.supabaseUrl, config.supabaseAnonKey, {
      auth: { persistSession: true, detectSessionInUrl: true, autoRefreshToken: true },
    });
    const { data } = await client.auth.getSession();
    renderAuth(data.session);
    client.auth.onAuthStateChange((_event, session) => {
      setTimeout(() => renderAuth(session), 0);
    });
  }

  window.CielSync = { notifyLocalChange, syncNow };
  init();
})();
