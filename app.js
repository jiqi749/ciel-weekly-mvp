const STORAGE_KEY = "ciel-weekly-mvp-v3";

const typeMeta = {
  portfolio: { label: "主线 / 作品集", shortLabel: "作品集", group: "personal", target: 3 },
  relationship: { label: "关系 / 共同时间", shortLabel: "认真陪伴", group: "personal", target: 5 },
  climbing: { label: "攀岩", shortLabel: "攀岩", group: "personal", target: 3 },
  health: { label: "健康 / 康复", shortLabel: "健康 / 康复", group: "personal", target: 3 },
  life: { label: "生活必要", shortLabel: "生活必要", group: "personal", target: 0 },
  work: { label: "工作承诺", shortLabel: "工作", group: "work", target: 0 },
  leisure: { label: "自由活动", shortLabel: "自由活动", group: "personal", target: 0 },
};

const decisionMeta = {
  today: "今天必须做",
  week: "本周必须做",
  later: "以后再说",
};

const statusMeta = {
  planned: "已安排",
  active: "进行中",
  verified: "完成并计入",
  unqualified: "完成但不计入",
  interrupted: "被打断",
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const now = new Date();
const todayKey = toDateKey(now);

let viewedWeekStart = startOfWeek(now);

const defaultState = {
  mode: "normal",
  plans: [],
  inbox: [],
  reviews: {},
  notes: {},
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
      plans: Array.isArray(parsed.plans) ? parsed.plans.map(normalizePlan) : [],
      inbox: Array.isArray(parsed.inbox) ? parsed.inbox.map(normalizeInboxItem) : [],
      reviews: parsed.reviews || {},
      notes: parsed.notes || {},
    };
  } catch {
    return structuredClone(defaultState);
  }
}

function normalizePlan(plan) {
  const status = plan.status === "done" ? "verified" : (statusMeta[plan.status] ? plan.status : "planned");
  return {
    outcome: "",
    intention: "",
    confirmed: false,
    ...plan,
    type: typeMeta[plan.type] ? plan.type : "life",
    status,
  };
}

function normalizeInboxItem(item) {
  const fallbackDecision = item.status === "later" ? "later" : "week";
  return {
    ...item,
    category: typeMeta[item.category] ? item.category : "life",
    decision: decisionMeta[item.decision] ? item.decision : fallbackDecision,
  };
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  window.CielSync?.notifyLocalChange();
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
  return toDateKey(startOfWeek(fromDateKey(dateKey))) === toDateKey(weekStart);
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

function parseTime(value) {
  const [hours, minutes] = String(value || "00:00").split(":").map(Number);
  return (Number.isFinite(hours) ? hours : 0) * 60 + (Number.isFinite(minutes) ? minutes : 0);
}

function formatDuration(minutes) {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (!hours) return `${rest}m`;
  return `${hours}h${rest ? `${rest}m` : ""}`;
}

function init() {
  $("#todayLabel").textContent = new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long",
  }).format(now);
  $("#planDate").value = todayKey;
  bindEvents();
  render();
}

function bindEvents() {
  $$('[data-mode]').forEach((button) => {
    button.addEventListener("click", () => {
      state.mode = button.dataset.mode;
      saveState();
      renderMode();
      renderProgress();
      renderWeekSummary();
    });
  });

  $("#previousWeek").addEventListener("click", () => {
    viewedWeekStart = addDays(viewedWeekStart, -7);
    renderWeek();
  });
  $("#nextWeek").addEventListener("click", () => {
    viewedWeekStart = addDays(viewedWeekStart, 7);
    renderWeek();
  });
  $("#currentWeek").addEventListener("click", () => {
    viewedWeekStart = startOfWeek(now);
    renderWeek();
  });

  $("#planType").addEventListener("change", renderConditionalPlanFields);
  $("#planForm").addEventListener("submit", savePlanFromForm);
  $("#cancelPlanEdit").addEventListener("click", closePlanDialog);
  $("#inboxForm").addEventListener("submit", captureInbox);
  $("#reviewForm").addEventListener("submit", saveReview);
  $("#noteForm").addEventListener("submit", saveNote);
  $("#completeForm").addEventListener("submit", completePlan);
  $("#completeForm").elements.result.addEventListener("change", updateCompleteRequirement);
  $("#closeCompleteDialog").addEventListener("click", () => $("#completeDialog").close());
  $("#exportButton").addEventListener("click", exportBackup);
}

function render() {
  renderMode();
  renderTimeline();
  renderWeek();
  renderInbox();
  renderTodayInboxPreview();
  renderReview();
  renderNote();
  renderConditionalPlanFields();
}

function renderMode() {
  $$('[data-mode]').forEach((button) => button.classList.toggle("active", button.dataset.mode === state.mode));
  $("#modeHint").textContent = state.mode === "normal"
    ? "按普通目标运行；变化发生时重新安排，不牺牲睡眠。"
    : "出差、高压或恢复期：主动降级目标，不把未完成当失败。";
}

function plansForWeek() {
  return state.plans.filter((plan) => isSameWeek(plan.date));
}

function layoutTimeline(plans) {
  const sorted = plans
    .map((plan) => ({ plan, start: parseTime(plan.start), end: parseTime(plan.start) + Number(plan.duration || 0) }))
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const result = [];
  let cluster = [];
  let clusterEnd = -1;

  function flushCluster() {
    if (!cluster.length) return;
    const columnEnds = [];
    cluster.forEach((item) => {
      let column = columnEnds.findIndex((end) => end <= item.start);
      if (column === -1) column = columnEnds.length;
      columnEnds[column] = item.end;
      item.column = column;
    });
    const columnCount = Math.max(columnEnds.length, 1);
    cluster.forEach((item) => result.push({ ...item, columnCount }));
    cluster = [];
  }

  sorted.forEach((item) => {
    if (cluster.length && item.start >= clusterEnd) flushCluster();
    cluster.push(item);
    clusterEnd = Math.max(clusterEnd, item.end);
  });
  flushCluster();
  return result;
}

function renderTimeline() {
  const timeline = $("#todayTimeline");
  const startMinute = 7 * 60;
  const endMinute = 24 * 60;
  const hourHeight = 64;
  const totalHeight = ((endMinute - startMinute) / 60) * hourHeight;
  const plans = state.plans.filter((plan) => plan.date === todayKey);
  const visiblePlans = plans.filter((plan) => {
    const start = parseTime(plan.start);
    return start < endMinute && start + Number(plan.duration || 0) > startMinute;
  });
  const laidOut = layoutTimeline(visiblePlans);

  timeline.style.minHeight = `${totalHeight + 2}px`;
  const hourLabels = [];
  for (let hour = 7; hour <= 24; hour += 1) {
    hourLabels.push(`<span class="timeline-hour" style="top:${(hour - 7) * hourHeight}px">${String(hour).padStart(2, "0")}:00</span>`);
  }

  const planBlocks = laidOut.map(({ plan, start, end, column, columnCount }) => {
    const top = Math.max(0, ((start - startMinute) / 60) * hourHeight);
    const clippedEnd = Math.min(end, endMinute);
    const height = Math.max(52, ((clippedEnd - Math.max(start, startMinute)) / 60) * hourHeight - 3);
    const left = (column / columnCount) * 100;
    const width = 100 / columnCount;
    const intention = plan.intention ? `<p class="block-intention">目标：${escapeHtml(plan.intention)}</p>` : "";
    return `
      <article class="timeline-block ${escapeHtml(plan.type)} is-${escapeHtml(plan.status)}" style="top:${top}px;height:${height}px;left:${left}%;width:calc(${width}% - 4px)">
        <time>${escapeHtml(plan.start)} · ${formatDuration(Number(plan.duration || 0))}</time>
        <strong>${escapeHtml(plan.title)}</strong>
        ${intention}
        <div class="timeline-actions">${timelineActions(plan)}</div>
      </article>
    `;
  }).join("");

  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const nowLine = currentMinutes >= startMinute && currentMinutes <= endMinute
    ? `<span class="timeline-now" style="top:${((currentMinutes - startMinute) / 60) * hourHeight}px"></span>`
    : "";

  timeline.innerHTML = `${hourLabels.join("")}<div class="timeline-lane">${nowLine}${planBlocks || '<p class="timeline-empty">今天还没有时间块。</p>'}</div>`;
  timeline.querySelectorAll("[data-plan-action]").forEach((button) => {
    button.addEventListener("click", () => handlePlanAction(button.dataset.planAction, button.dataset.planId));
  });
  bindTimelineCreation(timeline.querySelector(".timeline-lane"));
}

function minutesToTime(minutes) {
  const bounded = Math.max(0, Math.min(23 * 60 + 59, minutes));
  return `${String(Math.floor(bounded / 60)).padStart(2, "0")}:${String(bounded % 60).padStart(2, "0")}`;
}

function bindTimelineCreation(lane) {
  if (!lane) return;
  const dayStart = 7 * 60;
  const dayEnd = 24 * 60;
  const snap = 15;
  let holdTimer = null;
  let activePointer = null;
  let anchorMinute = null;
  let currentMinute = null;
  let anchorY = null;
  let draft = null;
  let dragging = false;

  const minuteFromEvent = (event) => {
    const rect = lane.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));
    const raw = dayStart + ratio * (dayEnd - dayStart);
    return Math.max(dayStart, Math.min(dayEnd, Math.round(raw / snap) * snap));
  };

  const updateDraft = () => {
    if (!draft) return;
    const start = Math.min(anchorMinute, currentMinute);
    const end = Math.max(anchorMinute, currentMinute);
    const top = ((start - dayStart) / (dayEnd - dayStart)) * 100;
    const duration = Math.max(30, end - start);
    const height = (duration / (dayEnd - dayStart)) * 100;
    draft.style.top = `${top}%`;
    draft.style.height = `${height}%`;
    draft.textContent = `${minutesToTime(start)} · ${duration} 分钟`;
  };

  const beginDrag = (event) => {
    dragging = true;
    activePointer = event.pointerId;
    anchorMinute = Math.min(dayEnd - 30, minuteFromEvent(event));
    currentMinute = anchorMinute;
    draft = document.createElement("div");
    draft.className = "timeline-draft";
    lane.append(draft);
    try { lane.setPointerCapture(event.pointerId); } catch { /* pointer may already belong to scrolling */ }
    updateDraft();
  };

  const clearGesture = () => {
    clearTimeout(holdTimer);
    holdTimer = null;
    activePointer = null;
    anchorMinute = null;
    currentMinute = null;
    anchorY = null;
    dragging = false;
    draft?.remove();
    draft = null;
  };

  lane.addEventListener("pointerdown", (event) => {
    if (event.target.closest(".timeline-block")) return;
    anchorY = event.clientY;
    if (event.pointerType === "mouse" || event.pointerType === "pen") {
      beginDrag(event);
    } else {
      holdTimer = setTimeout(() => beginDrag(event), 360);
    }
  });

  lane.addEventListener("pointermove", (event) => {
    if (!dragging) {
      if (anchorY !== null && Math.abs(event.clientY - anchorY) > 8) {
        clearTimeout(holdTimer);
        holdTimer = null;
      }
      return;
    }
    if (event.pointerId !== activePointer) return;
    event.preventDefault();
    currentMinute = minuteFromEvent(event);
    updateDraft();
  });

  lane.addEventListener("pointerup", (event) => {
    clearTimeout(holdTimer);
    if (!dragging || event.pointerId !== activePointer) {
      clearGesture();
      return;
    }
    currentMinute = minuteFromEvent(event);
    const start = Math.min(anchorMinute, currentMinute);
    const end = Math.max(anchorMinute, currentMinute);
    const duration = Math.max(30, Math.round((end - start) / snap) * snap);
    clearGesture();
    openPlanForDate(todayKey, { start: minutesToTime(start), duration });
  });

  lane.addEventListener("pointercancel", clearGesture);
}

function timelineActions(plan) {
  if (plan.status === "planned") {
    return `${actionButton("start", plan.id, "开始")}${actionButton("edit", plan.id, "调整")}${actionButton("delete", plan.id, "删除")}`;
  }
  if (plan.status === "active") {
    return `${actionButton("finish", plan.id, "结束审查")}${actionButton("interrupt", plan.id, "被打断")}`;
  }
  if (plan.status === "interrupted") {
    return `${actionButton("move", plan.id, "重新安排")}${actionButton("edit", plan.id, "调整")}`;
  }
  return `${actionButton("finish", plan.id, "修改结果")}${actionButton("edit", plan.id, "调整")}`;
}

function actionButton(action, id, label) {
  return `<button type="button" data-plan-action="${action}" data-plan-id="${id}">${label}</button>`;
}

function handlePlanAction(action, id) {
  const plan = state.plans.find((item) => item.id === id);
  if (!plan) return;
  if (action === "start") {
    plan.status = "active";
    saveState();
    render();
  } else if (action === "finish") {
    openCompleteDialog(plan);
  } else if (action === "interrupt") {
    plan.status = "interrupted";
    saveState();
    render();
  } else if (action === "edit") {
    editPlan(plan);
  } else if (action === "move") {
    movePlan(plan);
  } else if (action === "delete") {
    deletePlan(plan.id);
  }
}

function renderWeek() {
  $("#weekRange").textContent = formatWeekRange(viewedWeekStart);
  renderProgress();
  renderWeekSummary();
  renderWeekGrid();
}

function renderProgress() {
  const plans = plansForWeek();
  const focusTypes = ["portfolio", "relationship", "climbing", "health"];
  $("#progressTracks").innerHTML = focusTypes.map((type) => {
    const meta = typeMeta[type];
    const matching = plans.filter((plan) => plan.type === type);
    const verified = matching.filter((plan) => plan.status === "verified").length;
    const scheduledMinutes = matching.reduce((sum, plan) => sum + Number(plan.duration || 0), 0);
    const slotCount = Math.max(meta.target, matching.length, 1);
    const segments = Array.from({ length: slotCount }, (_, index) => {
      const filled = index < matching.length ? " filled" : "";
      const stamped = index < verified ? " verified" : "";
      return `<span class="progress-segment${filled}${stamped}"></span>`;
    }).join("");
    const modeSuffix = state.mode === "special" ? " · 已降级" : "";
    return `
      <div class="progress-row ${type}">
        <div class="progress-label"><strong>${meta.shortLabel}</strong><small>目标 ${meta.target} 次${modeSuffix}</small></div>
        <div class="progress-segments">${segments}</div>
        <span class="progress-count">已安排 ${matching.length} · ${formatDuration(scheduledMinutes)}｜计入 ${verified}</span>
      </div>
    `;
  }).join("");
}

function renderWeekSummary() {
  const plans = plansForWeek();
  const verified = plans.filter((plan) => plan.status === "verified").length;
  const interrupted = plans.filter((plan) => plan.status === "interrupted").length;
  const unqualified = plans.filter((plan) => plan.status === "unqualified").length;
  const portfolio = plans.filter((plan) => plan.type === "portfolio").length;
  const pendingWeekItems = state.inbox.filter((item) => item.status !== "scheduled" && item.decision === "week").length;
  const messages = [];
  if (portfolio < 3 && state.mode === "normal") messages.push(`作品集还差 ${3 - portfolio} 段安排`);
  if (verified) messages.push(`${verified} 段投入完成并计入进度`);
  if (interrupted) messages.push(`${interrupted} 段被打断，等待重新安排`);
  if (unqualified) messages.push(`${unqualified} 段做过但没有计入进度`);
  if (pendingWeekItems) messages.push(`收件箱还有 ${pendingWeekItems} 件“本周必须做”尚未安排`);
  if (!messages.length) messages.push("本周还没有真实结果；先为关键投入找到位置。");
  $("#weekSummary").innerHTML = messages.map((message) => `<span>${escapeHtml(message)}</span>`).join("");
}

function renderWeekGrid() {
  const grid = $("#weekGrid");
  grid.innerHTML = "";
  for (let index = 0; index < 7; index += 1) {
    const date = addDays(viewedWeekStart, index);
    const key = toDateKey(date);
    const plans = state.plans.filter((plan) => plan.date === key).sort((a, b) => a.start.localeCompare(b.start));
    const relation = key === todayKey ? "is-today" : (date < fromDateKey(todayKey) ? "is-past" : "is-future");
    const verifiedCount = plans.filter((plan) => plan.status === "verified").length;
    const issueCount = plans.filter((plan) => ["unqualified", "interrupted"].includes(plan.status)).length;
    const card = document.createElement("article");
    card.className = `day-file ${relation}`;
    card.innerHTML = `
      <div class="day-file-header">
        <span>${new Intl.DateTimeFormat("en", { weekday: "short" }).format(date)}</span>
        <strong>${date.getDate()}</strong>
      </div>
      <div class="day-plan-list">
        ${plans.length ? plans.map(renderWeekPlan).join("") : '<span class="day-empty">留白</span>'}
      </div>
      <div class="day-file-actions">
        <span>${date < fromDateKey(todayKey) ? `计入 ${verifiedCount}${issueCount ? ` · 待处理 ${issueCount}` : ""}` : `${plans.length} 个安排`}</span>
        <button type="button" data-add-date="${key}">＋ 添加</button>
      </div>
    `;
    card.querySelector(`[data-add-date="${key}"]`).addEventListener("click", () => openPlanForDate(key));
    card.querySelectorAll("[data-edit-plan]").forEach((button) => {
      button.addEventListener("click", () => {
        const plan = state.plans.find((item) => item.id === button.dataset.editPlan);
        if (plan) editPlan(plan);
      });
    });
    grid.append(card);
  }
}

function renderWeekPlan(plan) {
  return `<button type="button" class="week-plan ${escapeHtml(plan.type)} is-${escapeHtml(plan.status)}" data-edit-plan="${plan.id}"><strong>${escapeHtml(plan.start)}</strong> ${escapeHtml(plan.title)}</button>`;
}

function renderConditionalPlanFields() {
  const type = $("#planType").value;
  const isConfirmedType = ["relationship", "climbing"].includes(type);
  $("#confirmedField").classList.toggle("is-hidden", !isConfirmedType);
  const intentionInput = $("#planForm").elements.intention;
  intentionInput.required = type === "portfolio";
  $("#intentionField").querySelector("span").textContent = type === "portfolio" ? "结束时要留下什么？（必填）" : "结束时要留下什么？（可选）";
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
    intention: data.get("intention").trim(),
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
  $("#planDialog").close();
  resetPlanForm();
  render();
}

function openPlanForDate(dateKey, defaults = {}) {
  resetPlanForm();
  $("#planDate").value = dateKey;
  if (defaults.type && typeMeta[defaults.type]) $("#planType").value = defaults.type;
  if (defaults.title) $("#planTitle").value = defaults.title;
  if (defaults.start) $("#planForm").elements.start.value = defaults.start;
  if (defaults.duration) setPlanDuration(defaults.duration);
  if (defaults.sourceInboxId) $("#planForm").elements.sourceInboxId.value = defaults.sourceInboxId;
  renderConditionalPlanFields();
  $("#planDialogTitle").textContent = "安排时间";
  $("#planDialog").showModal();
  setTimeout(() => $("#planForm").elements.start.focus(), 350);
}

function editPlan(plan) {
  const form = $("#planForm");
  form.elements.editingId.value = plan.id;
  form.elements.date.value = plan.date;
  form.elements.start.value = plan.start;
  setPlanDuration(plan.duration);
  form.elements.type.value = plan.type;
  form.elements.title.value = plan.title;
  form.elements.intention.value = plan.intention || "";
  form.elements.confirmed.checked = Boolean(plan.confirmed);
  $("#planDialogTitle").textContent = "调整时间块";
  renderConditionalPlanFields();
  $("#planDialog").showModal();
}

function resetPlanForm() {
  const form = $("#planForm");
  form.reset();
  form.elements.duration.querySelector("[data-custom-duration]")?.remove();
  form.elements.editingId.value = "";
  form.elements.sourceInboxId.value = "";
  form.elements.date.value = todayKey;
  form.elements.duration.value = "90";
  renderConditionalPlanFields();
}

function setPlanDuration(duration) {
  const select = $("#planForm").elements.duration;
  const value = String(Number(duration));
  select.querySelector("[data-custom-duration]")?.remove();
  if (![...select.options].some((option) => option.value === value)) {
    const option = new Option(`${value} 分钟`, value, true, true);
    option.dataset.customDuration = "true";
    select.add(option);
  }
  select.value = value;
}

function closePlanDialog() {
  $("#planDialog").close();
  resetPlanForm();
}

function movePlan(plan) {
  const nextDate = window.prompt("移动到哪一天？请输入 YYYY-MM-DD", plan.date);
  if (!nextDate || !/^\d{4}-\d{2}-\d{2}$/.test(nextDate)) return;
  const nextTime = window.prompt("几点开始？", plan.start);
  if (!nextTime || !/^\d{2}:\d{2}$/.test(nextTime)) return;
  plan.date = nextDate;
  plan.start = nextTime;
  plan.status = "planned";
  if (["relationship", "climbing"].includes(plan.type)) plan.confirmed = false;
  viewedWeekStart = startOfWeek(fromDateKey(nextDate));
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
  const form = $("#completeForm");
  form.reset();
  form.elements.planId.value = plan.id;
  form.elements.result.value = ["verified", "unqualified", "interrupted"].includes(plan.status) ? plan.status : "verified";
  form.elements.outcome.value = plan.outcome || "";
  $("#completeTitle").textContent = `结束：${plan.title}`;
  updateCompleteRequirement();
  $("#completeDialog").showModal();
}

function updateCompleteRequirement() {
  const form = $("#completeForm");
  const plan = state.plans.find((item) => item.id === form.elements.planId.value);
  const countedPortfolio = plan?.type === "portfolio" && form.elements.result.value === "verified";
  form.elements.outcome.required = countedPortfolio;
  $("#outcomeLabel").textContent = countedPortfolio
    ? "实际留下了什么？作品集计入进度必须有证据"
    : "实际发生了什么？（可选）";
}

function completePlan(event) {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  const plan = state.plans.find((item) => item.id === data.get("planId"));
  if (!plan) return;
  plan.status = data.get("result");
  plan.outcome = data.get("outcome").trim();
  saveState();
  $("#completeDialog").close();
  render();
}

function captureInbox(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  const title = data.get("title").trim();
  const category = data.get("category");
  const decision = data.get("decision");
  const message = $("#inboxMessage");

  if (decision === "delete") {
    form.reset();
    message.textContent = `“${title}”已经删除，没有进入你的时间。`;
    setTimeout(() => { message.textContent = ""; }, 3200);
    return;
  }

  const item = {
    id: uid(),
    title,
    category,
    decision,
    status: "inbox",
    createdAt: new Date().toISOString(),
  };
  state.inbox.unshift(item);
  saveState();
  form.reset();
  renderInbox();
  renderTodayInboxPreview();
  renderWeekSummary();

  if (decision === "today") {
    message.textContent = "已经归入今天；接下来为它安排具体时间。";
    openPlanForDate(todayKey, { title, type: category, sourceInboxId: item.id });
  } else {
    message.textContent = decision === "week" ? "已经标记为本周必须做；安排后才会进入日历。" : "已经放入以后再说。";
  }
  setTimeout(() => { message.textContent = ""; }, 3200);
}

function renderInbox() {
  const container = $("#inboxList");
  const visible = state.inbox.filter((item) => item.status !== "scheduled");
  const groups = ["today", "week", "later"];
  container.innerHTML = groups.map((decision) => {
    const items = visible.filter((item) => item.decision === decision);
    return `
      <section class="inbox-group">
        <h3>${decisionMeta[decision]}</h3>
        ${items.length ? items.map(renderInboxItem).join("") : '<p class="empty-copy">这里是空的。</p>'}
      </section>
    `;
  }).join("");

  container.querySelectorAll("[data-schedule-inbox]").forEach((button) => {
    button.addEventListener("click", () => scheduleInboxItem(button.dataset.scheduleInbox));
  });
  container.querySelectorAll("[data-delete-inbox]").forEach((button) => {
    button.addEventListener("click", () => deleteInboxItem(button.dataset.deleteInbox));
  });
  container.querySelectorAll("[data-inbox-decision]").forEach((select) => {
    select.addEventListener("change", () => changeInboxDecision(select.dataset.inboxDecision, select.value));
  });
}

function renderInboxItem(item) {
  return `
    <article class="inbox-item">
      <strong>${escapeHtml(item.title)}</strong>
      <div class="tag-row">
        <span class="tag">${escapeHtml(typeMeta[item.category]?.label || "生活必要")}</span>
        <span class="tag decision">${escapeHtml(decisionMeta[item.decision])}</span>
      </div>
      <select class="decision-select" data-inbox-decision="${item.id}" aria-label="修改处理结果">
        ${Object.entries(decisionMeta).map(([value, label]) => `<option value="${value}" ${item.decision === value ? "selected" : ""}>${label}</option>`).join("")}
      </select>
      <div class="triage-actions">
        ${item.decision !== "later" ? `<button type="button" data-schedule-inbox="${item.id}">安排时间</button>` : ""}
        <button type="button" data-delete-inbox="${item.id}">删除</button>
      </div>
    </article>
  `;
}

function scheduleInboxItem(id) {
  const item = state.inbox.find((entry) => entry.id === id);
  if (!item) return;
  openPlanForDate(todayKey, { title: item.title, type: item.category, sourceInboxId: item.id });
}

function deleteInboxItem(id) {
  state.inbox = state.inbox.filter((entry) => entry.id !== id);
  saveState();
  renderInbox();
  renderTodayInboxPreview();
  renderWeekSummary();
}

function changeInboxDecision(id, decision) {
  const item = state.inbox.find((entry) => entry.id === id);
  if (!item || !decisionMeta[decision]) return;
  item.decision = decision;
  saveState();
  renderInbox();
  renderTodayInboxPreview();
  renderWeekSummary();
}

function renderTodayInboxPreview() {
  const items = state.inbox.filter((item) => item.status !== "scheduled" && item.decision === "today");
  $("#todayInboxPreview").innerHTML = items.length
    ? `<div class="mini-inbox-list">${items.slice(0, 4).map((item) => `<div class="mini-inbox-item"><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(typeMeta[item.category]?.shortLabel || "生活")}</span></div>`).join("")}</div>`
    : '<p class="empty-copy">今天没有尚未安排的事项。</p>';
}

function saveReview(event) {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  state.reviews[todayKey] = {
    progress: data.get("progress").trim(),
    drift: data.get("drift").trim(),
    tomorrow: data.get("tomorrow").trim(),
  };
  saveState();
  $("#reviewSaved").textContent = "已保存";
  setTimeout(() => { $("#reviewSaved").textContent = ""; }, 2400);
}

function renderReview() {
  const review = state.reviews[todayKey] || {};
  const form = $("#reviewForm");
  form.elements.progress.value = review.progress || "";
  form.elements.drift.value = review.drift || "";
  form.elements.tomorrow.value = review.tomorrow || "";
}

function saveNote(event) {
  event.preventDefault();
  state.notes[todayKey] = $("#noteText").value.trim();
  saveState();
  $("#noteSaved").textContent = "已保存";
  setTimeout(() => { $("#noteSaved").textContent = ""; }, 2200);
}

function renderNote() {
  $("#noteText").value = state.notes[todayKey] || "";
}

function exportBackup() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `ciel-backup-${todayKey}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

function replaceStateFromSync(nextState) {
  state = {
    ...structuredClone(defaultState),
    ...(nextState || {}),
    plans: Array.isArray(nextState?.plans) ? nextState.plans.map(normalizePlan) : [],
    inbox: Array.isArray(nextState?.inbox) ? nextState.inbox.map(normalizeInboxItem) : [],
    reviews: nextState?.reviews || {},
    notes: nextState?.notes || {},
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  render();
}

window.CielApp = {
  getState: () => structuredClone(state),
  replaceStateFromSync,
  isStateEmpty: (candidate = state) => (
    !(candidate?.plans?.length) &&
    !(candidate?.inbox?.length) &&
    !Object.values(candidate?.reviews || {}).some((review) => review?.progress || review?.drift || review?.tomorrow) &&
    !Object.values(candidate?.notes || {}).some(Boolean)
  ),
};

init();
