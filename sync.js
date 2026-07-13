(function initializeCielSync() {
  const META_KEY = "ciel-sync-meta-v1";
  const REQUEST_TIMEOUT_MS = 12000;
  const config = window.CIEL_SYNC_CONFIG || {};
  const app = window.CielApp;
  const supabaseGlobal = window.supabase;

  let client = null;
  let user = null;
  let knownVersion = null;
  let pushTimer = null;
  let applyingRemote = false;
  let conflictResolver = null;
  let syncQueue = Promise.resolve();

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
    button.classList.remove("is-local", "is-synced", "is-syncing", "is-offline", "is-error");
    button.classList.add(`is-${status}`);
    const labels = {
      local: "仅本机",
      synced: "已同步",
      syncing: "同步中",
      offline: "暂时离线",
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

  async function fetchWithTimeout(input, init = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    const sourceSignal = init.signal;
    if (sourceSignal) {
      if (sourceSignal.aborted) controller.abort();
      else sourceSignal.addEventListener("abort", () => controller.abort(), { once: true });
    }
    try {
      return await window.fetch(input, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
  }

  function showConnectionIssue(action) {
    if (meta.lastSyncedAt) {
      setStatus("offline", `${action}连接失败；上次同步数据仍可使用`);
      showAccountMessage("网络暂时不可用。本机数据没有丢失，恢复连接后会继续同步。", true);
    } else {
      setStatus("error", `${action}失败，本机数据仍已保存`);
      showAccountMessage("暂时无法连接云端，本机数据没有丢失。", true);
    }
  }

  function isPayloadEmpty(payload) {
    return app.isStateEmpty(payload || {});
  }

  function canonicalize(value) {
    if (Array.isArray(value)) return value.map(canonicalize);
    if (value && typeof value === "object") {
      return Object.keys(value)
        .sort()
        .reduce((result, key) => {
          result[key] = canonicalize(value[key]);
          return result;
        }, {});
    }
    return value;
  }

  function payloadsMatch(left, right) {
    return JSON.stringify(canonicalize(left || {})) === JSON.stringify(canonicalize(right || {}));
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

  function enqueueSync(operation) {
    syncQueue = syncQueue.catch(() => {}).then(operation);
    return syncQueue;
  }

  async function performPushLocal() {
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
      showConnectionIssue("上传");
    }
  }

  function pushLocal() {
    return enqueueSync(performPushLocal);
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

  async function performSyncNow() {
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
        await performPushLocal();
      } else {
        await resolveRemoteConflict(remote);
      }
    } catch (error) {
      console.error("Ciel sync failed", error);
      showConnectionIssue("同步");
    }
  }

  function syncNow() {
    return enqueueSync(performSyncNow);
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

  function readCredentials(form) {
    const data = new FormData(form);
    return {
      email: String(data.get("email") || "").trim(),
      password: String(data.get("password") || ""),
    };
  }

  function authErrorMessage(error) {
    const value = String(error?.message || "").toLowerCase();
    if (error?.name === "AbortError" || value.includes("aborted")) return "连接超过 12 秒，请切换网络或稍后重试。";
    if (value.includes("failed to fetch") || value.includes("network")) return "无法连接同步服务，请切换网络或稍后重试。";
    if (value.includes("invalid login credentials")) return "邮箱或密码不正确。若是首次使用，请先创建账号。";
    if (value.includes("user already registered")) return "这个邮箱已经注册，请直接登录。";
    if (value.includes("password should be")) return "密码至少需要 8 位。";
    if (value.includes("rate limit")) return "尝试次数过多，请稍后再试。";
    return error?.message ? `操作失败：${error.message}` : "操作失败，请稍后再试。";
  }

  async function signInWithPassword(event) {
    event.preventDefault();
    const message = document.querySelector("#syncLoginMessage");
    const { email, password } = readCredentials(event.currentTarget);
    message.textContent = "正在登录……";
    const { error } = await client.auth.signInWithPassword({ email, password });
    message.textContent = error ? authErrorMessage(error) : "登录成功，正在同步……";
  }

  async function signUp() {
    const form = document.querySelector("#syncLoginForm");
    const message = document.querySelector("#syncLoginMessage");
    if (!form.reportValidity()) return;
    const { email, password } = readCredentials(form);
    message.textContent = "正在创建账号……";
    const { data, error } = await client.auth.signUp({ email, password });
    if (error) {
      message.textContent = authErrorMessage(error);
      return;
    }
    message.textContent = data.session ? "账号已创建，正在同步……" : "账号已创建，请登录。";
  }

  async function signOut() {
    await client.auth.signOut();
    renderAuth(null);
    document.querySelector("#syncDialog")?.close();
  }

  function bindUI() {
    document.querySelector("#syncButton")?.addEventListener("click", () => document.querySelector("#syncDialog")?.showModal());
    document.querySelector("#closeSyncDialog")?.addEventListener("click", () => document.querySelector("#syncDialog")?.close());
    document.querySelector("#syncLoginForm")?.addEventListener("submit", signInWithPassword);
    document.querySelector("#syncSignUpButton")?.addEventListener("click", signUp);
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
      global: { fetch: fetchWithTimeout },
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
