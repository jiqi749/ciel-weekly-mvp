const STORAGE_KEY = "ciel-weekly-mvp-v3";

const typeMeta = {
  portfolio: { label: "作品集", group: "personal" },
  relationship: { label: "共同时间", group: "personal" },
  climbing: { label: "攀岩", group: "personal" },
  health: { label: "健康 / 康复", group: "personal" },
  life: { label: "生活必要", group: "personal" },
  work: { label: "工作", group: "work" },
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const now = new Date();

let viewedWeekStart = startOfWeek(now);
let todayFilter = "all";

const defaultState = {
  mode: "normal",
  plans: [],
  inbox: [],
  reviews: {},
};

let state = loadState();

function loadState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return structuredClone(defaultState);
  try {
    const parsed = JSON.parse(raw);
    return {
      ...structuredClone(defaultState),
      ...parsed,
      plans: Array.isArray(parsed.plans) ? parsed.plans : [],
      inbox: Array.isArray(parsed.inbox) ? parsed.inbox : [],
      reviews: parsed.reviews || {},
    };
  } catch {
    return structuredClone(defaultState);
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function uid() {
  return crypto.randomUUID();
}

function toDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function fromDateKey(key) {
  return new Date(`${key}T00:00:00`);
}

function addDays(date, amount) {
  const next = new Date(date);
  next.setDate(next.getDate() + amount);
  return next;
}

function startOfWeek(date) {
  const next = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const day = next.getDay() || 7;
  next.setDate(next.getDate() - day + 1);
  return next;
}

function isSameWeek(dateKey, weekStart = viewedWeekStart) {
  const key = toDateKey(startOfWeek(fromDateKey(dateKey)));
  return key === toDateKey(weekStart);
}

function formatDay(date) {
  return new Intl.DateTimeFormat("zh-CN", { weekday: "short", month: "numeric", day: "numeric" }).format(date);
}

function formatWeekRange(start) {
  const end = addDays(start, 6);
  return `${start.getMonth() + 1}.${start.getDate()} — ${end.getMonth() + 1}.${end.getDate()}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function timeLabel(plan) {
  const hours = Math.floor(plan.duration / 60);
  const minutes = plan.duration % 60;
  const duration = hours ? `${hours}h${minutes ? `${minutes}m` : ""}` : `${minutes}m`;
  return `${plan.start} · ${duration}`;
}

function init() {
  $("#todayLabel").textContent = new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long",
  }).format(now);

  $("#planDate").value = toDateKey(now);
  bindEvents();
  render();
}

function bindEvents() {
  $$("[data-mode]").forEach((button) => {
    button.addEventListener("click", () => {
      state.mode = button.dataset.mode;
      saveState();
      renderMode();
      renderCompass();
    });
  });

  $$("#todayFilters button").forEach((button) => {
    button.addEventListener("click", () => {
      todayFilter = button.dataset.filter;
      $$("#todayFilters button").forEach((item) => item.classList.toggle("active", item === button));
      renderToday();
    });
  });

  $("#previousWeek").addEventListener("click", () => {
    viewedWeekStart = addDays(viewedWeekStart, -7);
    renderWeek();
    renderCompass();
  });

  $("#nextWeek").addEventListener("click", () => {
    viewedWeekStart = addDays(viewedWeekStart, 7);
    renderWeek();
    renderCompass();
  });

  $("#currentWeek").addEventListener("click", () => {
    viewedWeekStart = startOfWeek(now);
    renderWeek();
    renderCompass();
  });

  $("#planType").addEventListener("change", renderConfirmedField);
  $("#planForm").addEventListener("submit", savePlanFromForm);
  $("#cancelPlanEdit").addEventListener("click", resetPlanForm);
  $("#inboxForm").addEventListener("submit", captureInbox);
  $("#reviewForm").addEventListener("submit", saveReview);
  $("#completeForm").addEventListener("submit", completePlan);
  $("#closeCompleteDialog").addEventListener("click", () => $("#completeDialog").close());
  $("#exportButton").addEventListener("click", exportBackup);
}

function render() {
  renderMode();
  renderToday();
  renderWeek();
  renderCompass();
  renderInbox();
  renderReview();
  renderConfirmedField();
}

function renderMode() {
  $$("[data-mode]").forEach((button) => button.classList.toggle("active", button.dataset.mode === state.mode));
  $("#modeHint").textContent = state.mode === "normal"
    ? "按普通目标运行；变化发生时重新安排，不牺牲睡眠。"
    : "出差、高压或恢复期：主动降级目标，不把未完成当失败。";
}

function plansForWeek() {
  return state.plans.filter((plan) => isSameWeek(plan.date));
}

function renderCompass() {
  const weekPlans = plansForWeek();
  const count = (type, completedOnly = false) => weekPlans.filter((plan) => (
    plan.type === type && (!completedOnly || plan.status === "done")
  )).length;
  const relationshipDays = new Set(weekPlans.filter((plan) => plan.type === "relationship").map((plan) => plan.date)).size;
  const suffix = state.mode === "special" ? " · 已降级" : "";
  $("#portfolioProgress").textContent = `${count("portfolio")} / 3${suffix}`;
  $("#relationshipProgress").textContent = `${relationshipDays} 天${suffix}`;
  $("#climbingProgress").textContent = `${count("climbing")} / 3${suffix}`;
}

function renderToday() {
  const todayKey = toDateKey(now);
  const plans = state.plans
    .filter((plan) => plan.date === todayKey)
    .filter((plan) => todayFilter === "all" || typeMeta[plan.type].group === todayFilter)
    .sort((a, b) => a.start.localeCompare(b.start));
  const list = $("#todayList");
  list.innerHTML = "";

  if (!plans.length) {
    list.innerHTML = `<div class="empty-state"><strong>今天还没有安排。</strong><span>先看本周，再决定今天真正要保护什么。</span><button type="button" id="emptyAddPlan">安排时间</button></div>`;
    $("#emptyAddPlan").addEventListener("click", () => openPlanForDate(todayKey));
    return;
  }

  plans.forEach((plan) => list.append(createPlanCard(plan, true)));
}

function renderWeek() {
  $("#weekRange").textContent = formatWeekRange(viewedWeekStart);
  renderWeekSummary();
  const grid = $("#weekGrid");
  grid.innerHTML = "";
  const todayKey = toDateKey(now);

  for (let index = 0; index < 7; index += 1) {
    const date = addDays(viewedWeekStart, index);
    const key = toDateKey(date);
    const plans = state.plans.filter((plan) => plan.date === key).sort((a, b) => a.start.localeCompare(b.start));
    const column = document.createElement("article");
    column.className = `day-column ${key === todayKey ? "is-today" : ""}`;
    column.innerHTML = `
      <button class="day-heading" type="button">
        <span>${new Intl.DateTimeFormat("zh-CN", { weekday: "short" }).format(date)}</span>
        <strong>${date.getDate()}</strong>
      </button>
      <div class="day-plans"></div>
      <button class="day-add" type="button">＋</button>
    `;
    column.querySelector(".day-heading").addEventListener("click", () => openPlanForDate(key));
    column.querySelector(".day-add").addEventListener("click", () => openPlanForDate(key));
    const planList = column.querySelector(".day-plans");
    if (!plans.length) planList.innerHTML = `<span class="day-empty">留白</span>`;
    plans.forEach((plan) => planList.append(createPlanCard(plan, false)));
    grid.append(column);
  }
}

function renderWeekSummary() {
  const plans = plansForWeek();
  const portfolio = plans.filter((plan) => plan.type === "portfolio").length;
  const climbing = plans.filter((plan) => plan.type === "climbing").length;
  const unconfirmed = plans.filter((plan) => ["relationship", "climbing"].includes(plan.type) && !plan.confirmed).length;
  const weekdays = new Set(plans.filter((plan) => {
    const day = fromDateKey(plan.date).getDay();
    return day >= 1 && day <= 5 && ["portfolio", "climbing"].includes(plan.type);
  }).map((plan) => plan.date)).size;

  const messages = [];
  if (portfolio < 3 && state.mode === "normal") messages.push(`作品集还差 ${3 - portfolio} 段`);
  if (climbing < 3 && state.mode === "normal") messages.push(`攀岩还差 ${3 - climbing} 次`);
  if (unconfirmed) messages.push(`${unconfirmed} 个共同安排尚未确认`);
  if (weekdays >= 5) messages.push("5 个工作日晚间已占满，给意外留一个周末缓冲");
  if (!messages.length) messages.push("关键时间已经有位置；别再用小事把它们挤掉。");

  $("#weekSummary").innerHTML = messages.map((message) => `<span>${escapeHtml(message)}</span>`).join("");
}

function createPlanCard(plan, expanded) {
  const card = document.createElement("div");
  card.className = `plan-card ${plan.type} ${plan.status === "done" ? "is-done" : ""}`;
  const confirmation = ["relationship", "climbing"].includes(plan.type)
    ? `<span class="confirmation ${plan.confirmed ? "confirmed" : ""}">${plan.confirmed ? "已确认" : "待商量"}</span>`
    : "";
  card.innerHTML = `
    <div class="plan-meta">
      <span>${timeLabel(plan)}</span>
      ${confirmation}
    </div>
    <strong>${escapeHtml(plan.title)}</strong>
    ${plan.outcome ? `<p class="plan-outcome">留下：${escapeHtml(plan.outcome)}</p>` : ""}
    <div class="plan-actions">
      <button class="complete-action" type="button">${plan.status === "done" ? "已完成" : "完成"}</button>
      <button class="edit-action" type="button">调整</button>
      ${expanded || plan.type === "portfolio" ? `<button class="move-action" type="button">改期</button>` : ""}
      <button class="delete-action" type="button" aria-label="删除">×</button>
    </div>
  `;
  card.querySelector(".complete-action").addEventListener("click", () => openCompleteDialog(plan));
  card.querySelector(".edit-action").addEventListener("click", () => editPlan(plan));
  card.querySelector(".move-action")?.addEventListener("click", () => movePlan(plan));
  card.querySelector(".delete-action").addEventListener("click", () => deletePlan(plan.id));
  return card;
}

function renderConfirmedField() {
  const type = $("#planType").value;
  $("#confirmedField").classList.toggle("is-hidden", !["relationship", "climbing"].includes(type));
}

function savePlanFromForm(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  const editingId = data.get("editingId");
  const sourceInboxId = data.get("sourceInboxId");
  const payload = {
    date: data.get("date"),
    start: data.get("start"),
    duration: Number(data.get("duration")),
    type: data.get("type"),
    title: data.get("title").trim(),
    confirmed: data.get("confirmed") === "on",
  };

  if (editingId) {
    const plan = state.plans.find((item) => item.id === editingId);
    if (plan) Object.assign(plan, payload);
  } else {
    state.plans.push({ id: uid(), status: "planned", outcome: "", ...payload });
  }

  if (sourceInboxId) {
    const sourceItem = state.inbox.find((item) => item.id === sourceInboxId);
    if (sourceItem) sourceItem.status = "scheduled";
  }

  viewedWeekStart = startOfWeek(fromDateKey(payload.date));
  saveState();
  resetPlanForm();
  render();
}

function openPlanForDate(dateKey, defaults = {}) {
  resetPlanForm();
  $("#planDate").value = dateKey;
  if (defaults.type) $("#planType").value = defaults.type;
  if (defaults.title) $("#planTitle").value = defaults.title;
  if (defaults.sourceInboxId) $("#planForm").elements.sourceInboxId.value = defaults.sourceInboxId;
  renderConfirmedField();
  $("#addPlanDetails").open = true;
  $("#addPlanDetails").scrollIntoView({ behavior: "smooth", block: "center" });
  setTimeout(() => $("#planForm").elements.start.focus(), 350);
}

function editPlan(plan) {
  const form = $("#planForm");
  form.elements.editingId.value = plan.id;
  form.elements.date.value = plan.date;
  form.elements.start.value = plan.start;
  form.elements.duration.value = String(plan.duration);
  form.elements.type.value = plan.type;
  form.elements.title.value = plan.title;
  form.elements.confirmed.checked = Boolean(plan.confirmed);
  $("#cancelPlanEdit").classList.remove("is-hidden");
  $("#addPlanDetails").open = true;
  renderConfirmedField();
  $("#addPlanDetails").scrollIntoView({ behavior: "smooth", block: "center" });
}

function resetPlanForm() {
  const form = $("#planForm");
  form.reset();
  form.elements.editingId.value = "";
  form.elements.sourceInboxId.value = "";
  form.elements.date.value = toDateKey(now);
  form.elements.duration.value = "90";
  $("#cancelPlanEdit").classList.add("is-hidden");
  renderConfirmedField();
}

function movePlan(plan) {
  const nextDate = window.prompt("移动到哪一天？请输入 YYYY-MM-DD", plan.date);
  if (!nextDate || !/^\d{4}-\d{2}-\d{2}$/.test(nextDate)) return;
  const nextTime = window.prompt("几点开始？", plan.start);
  if (!nextTime || !/^\d{2}:\d{2}$/.test(nextTime)) return;
  plan.date = nextDate;
  plan.start = nextTime;
  if (["relationship", "climbing"].includes(plan.type)) plan.confirmed = false;
  saveState();
  render();
}

function deletePlan(id) {
  if (!window.confirm("删除这段安排？")) return;
  state.plans = state.plans.filter((plan) => plan.id !== id);
  saveState();
  render();
}

function openCompleteDialog(plan) {
  if (plan.status === "done") {
    plan.status = "planned";
    plan.outcome = "";
    saveState();
    render();
    return;
  }
  const form = $("#completeForm");
  form.reset();
  form.elements.planId.value = plan.id;
  $("#completeTitle").textContent = `完成：${plan.title}`;
  const needsEvidence = plan.type === "portfolio";
  $("#outcomeLabel").textContent = needsEvidence ? "实际留下了什么？作品集需要具体证据" : "实际完成了什么？（可选）";
  form.elements.outcome.required = needsEvidence;
  $("#completeDialog").showModal();
}

function completePlan(event) {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  const plan = state.plans.find((item) => item.id === data.get("planId"));
  if (!plan) return;
  plan.status = "done";
  plan.outcome = data.get("outcome").trim();
  saveState();
  $("#completeDialog").close();
  render();
}

function captureInbox(event) {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  state.inbox.unshift({
    id: uid(),
    title: data.get("title").trim(),
    status: "inbox",
    createdAt: new Date().toISOString(),
  });
  saveState();
  event.currentTarget.reset();
  renderInbox();
}

function renderInbox() {
  const list = $("#inboxList");
  list.innerHTML = "";
  const inbox = state.inbox.filter((item) => item.status === "inbox");
  if (!inbox.length) {
    list.innerHTML = `<div class="empty-state compact"><strong>收件箱是空的。</strong><span>记下来只是防止遗忘，不代表它值得进入今天。</span></div>`;
    return;
  }

  inbox.forEach((item) => {
    const row = document.createElement("div");
    row.className = "inbox-item";
    row.innerHTML = `
      <strong>${escapeHtml(item.title)}</strong>
      <div class="triage-actions">
        <button type="button" data-action="portfolio">推进作品</button>
        <button type="button" data-action="schedule">有时间点</button>
        <button type="button" data-action="later">以后再说</button>
        <button type="button" data-action="delete" aria-label="删除">×</button>
      </div>
    `;
    row.querySelectorAll("button").forEach((button) => {
      button.addEventListener("click", () => triageInbox(item, button.dataset.action));
    });
    list.append(row);
  });
}

function triageInbox(item, action) {
  if (action === "delete") {
    state.inbox = state.inbox.filter((entry) => entry.id !== item.id);
    saveState();
    renderInbox();
    return;
  }
  if (action === "later") {
    item.status = "later";
    saveState();
    renderInbox();
    return;
  }
  openPlanForDate(toDateKey(now), {
    title: item.title,
    type: action === "portfolio" ? "portfolio" : "life",
    sourceInboxId: item.id,
  });
}

function saveReview(event) {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  state.reviews[toDateKey(now)] = {
    progress: data.get("progress").trim(),
    drift: data.get("drift").trim(),
    tomorrow: data.get("tomorrow").trim(),
  };
  saveState();
  $("#reviewSaved").textContent = "已保存在这台设备上";
  setTimeout(() => { $("#reviewSaved").textContent = ""; }, 2400);
}

function renderReview() {
  const review = state.reviews[toDateKey(now)] || {};
  const form = $("#reviewForm");
  form.elements.progress.value = review.progress || "";
  form.elements.drift.value = review.drift || "";
  form.elements.tomorrow.value = review.tomorrow || "";
}

function exportBackup() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `ciel-backup-${toDateKey(now)}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

init();
