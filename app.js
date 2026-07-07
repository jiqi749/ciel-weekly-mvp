const STORAGE_KEY = "time-energy-board-v1";

const categoryLabels = {
  portfolio: "作品集",
  work: "公司",
  relationship: "关系",
  movement: "运动",
  life: "生活",
  rest: "休息",
  study: "学习",
};

const eventLabels = {
  protect: "保护块",
  work: "公司",
  life: "生活",
  relationship: "关系",
  movement: "运动",
};

const $ = (selector) => document.querySelector(selector);
const mainLineCategories = ["portfolio", "study"];
const workCategories = ["work"];
const dayStartHour = 6;
const dayEndHour = 24;

const today = new Date();
let selectedDate = toDateKey(today);
let visibleMonth = new Date(today.getFullYear(), today.getMonth(), 1);
let editingLogId = null;
let activeDrag = null;

const defaultState = {
  calibration: {
    mainGoal: "作品集",
    minimumAction: "改一页案例或写 5 条项目说明",
    energy: 3,
    noise: 3,
    high: "完整推进一个项目案例",
    mid: "整理素材并确定页面结构",
    low: "找 3 个参考，写下下一步",
  },
  logs: [
    {
      id: crypto.randomUUID(),
      date: toDateKey(today),
      start: "06:40",
      end: "07:20",
      title: "作品集案例拆解",
      category: "portfolio",
      energy: 5,
    },
    {
      id: crypto.randomUUID(),
      date: toDateKey(today),
      start: "09:30",
      end: "11:10",
      title: "公司项目推进",
      category: "work",
      energy: 3,
    },
    {
      id: crypto.randomUUID(),
      date: toDateKey(today),
      start: "14:20",
      end: "15:00",
      title: "飞书沟通与临时决策",
      category: "work",
      energy: 1,
    },
  ],
  events: [
    {
      id: crypto.randomUUID(),
      date: toDateKey(today),
      time: "20:30",
      title: "作品集保护块",
      type: "protect",
    },
    {
      id: crypto.randomUUID(),
      date: toDateKey(addDays(today, 1)),
      time: "19:30",
      title: "攀岩",
      type: "movement",
    },
  ],
  reminders: [
    {
      id: crypto.randomUUID(),
      date: toDateKey(today),
      time: "22:20",
      title: "睡前写明天第一保护块",
      done: false,
    },
  ],
  notes: {
    [toDateKey(today)]: "今天观察：哪些事情偷走了好精力？哪些时间块值得保护？",
  },
};

let state = loadState();

function loadState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(defaultState));
    return structuredClone(defaultState);
  }

  try {
    const parsed = JSON.parse(raw);
    const base = structuredClone(defaultState);
    return {
      ...base,
      ...parsed,
      calibration: { ...base.calibration, ...(parsed.calibration || {}) },
      notes: { ...base.notes, ...(parsed.notes || {}) },
      logs: parsed.logs || base.logs,
      events: parsed.events || base.events,
      reminders: parsed.reminders || base.reminders,
    };
  } catch {
    return structuredClone(defaultState);
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function toDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDays(date, amount) {
  const next = new Date(date);
  next.setDate(next.getDate() + amount);
  return next;
}

function parseMinutes(time) {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

function minutesBetween(start, end) {
  const startMinutes = parseMinutes(start);
  const endMinutes = parseMinutes(end);
  return Math.max(0, endMinutes - startMinutes);
}

function formatDuration(minutes) {
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
}

function formatDateLabel(dateKey) {
  const date = new Date(`${dateKey}T00:00:00`);
  return new Intl.DateTimeFormat("zh-CN", {
    month: "long",
    day: "numeric",
    weekday: "short",
  }).format(date);
}

function init() {
  $("#todayStamp").textContent = new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long",
  }).format(today);

  $("#logDate").value = selectedDate;
  $("#eventDate").value = selectedDate;
  $("#reminderDate").value = selectedDate;

  bindForms();
  render();
}

function bindForms() {
  $("#logForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const start = data.get("start");
    const end = data.get("end");
    if (minutesBetween(start, end) <= 0) return;

    const payload = {
      date: data.get("date"),
      start,
      end,
      title: data.get("title").trim(),
      category: data.get("category"),
      energy: Number(data.get("energy")),
    };

    if (editingLogId) {
      const index = state.logs.findIndex((log) => log.id === editingLogId);
      if (index >= 0) state.logs[index] = { ...state.logs[index], ...payload };
      editingLogId = null;
    } else {
      state.logs.push({ id: crypto.randomUUID(), ...payload });
    }

    selectedDate = payload.date;
    saveState();
    resetLogForm();
    render();
  });

  $("#cancelEditLogButton").addEventListener("click", resetLogForm);

  $("#eventForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    state.events.push({
      id: crypto.randomUUID(),
      date: data.get("date"),
      time: data.get("time"),
      title: data.get("title").trim(),
      type: data.get("type"),
    });
    selectedDate = data.get("date");
    visibleMonth = new Date(`${selectedDate}T00:00:00`);
    visibleMonth.setDate(1);
    saveState();
    event.currentTarget.reset();
    $("#eventDate").value = selectedDate;
    render();
  });

  $("#reminderForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    state.reminders.push({
      id: crypto.randomUUID(),
      date: data.get("date"),
      time: data.get("time"),
      title: data.get("title").trim(),
      done: false,
    });
    saveState();
    event.currentTarget.reset();
    $("#reminderDate").value = selectedDate;
    render();
  });

  $("#prevMonth").addEventListener("click", () => {
    visibleMonth.setMonth(visibleMonth.getMonth() - 1);
    renderCalendar();
  });

  $("#nextMonth").addEventListener("click", () => {
    visibleMonth.setMonth(visibleMonth.getMonth() + 1);
    renderCalendar();
  });

  $("#saveNoteButton").addEventListener("click", () => {
    state.notes[selectedDate] = $("#dayNote").value.trim();
    saveState();
    renderNotes();
  });

  $("#clearTodayButton").addEventListener("click", () => {
    if (!window.confirm("清空当前日期的所有时间记录？")) return;
    state.logs = state.logs.filter((log) => log.date !== selectedDate);
    saveState();
    render();
  });
}

function render() {
  renderFocusActions();
  renderMetrics();
  renderLogs();
  renderCalendar();
  renderEventsForSelectedDate();
  renderReminders();
  renderNotes();
}

function renderFocusActions() {
  $("#highEnergyAction").textContent = state.calibration.high;
  $("#midEnergyAction").textContent = state.calibration.mid;
  $("#lowEnergyAction").textContent = state.calibration.low;
}

function renderMetrics() {
  const logs = state.logs.filter((log) => log.date === selectedDate);
  const total = logs.reduce((sum, log) => sum + minutesBetween(log.start, log.end), 0);
  const protectedMinutes = logs
    .filter((log) => mainLineCategories.includes(log.category))
    .reduce((sum, log) => sum + minutesBetween(log.start, log.end), 0);
  const workMinutes = logs
    .filter((log) => workCategories.includes(log.category))
    .reduce((sum, log) => sum + minutesBetween(log.start, log.end), 0);
  const otherMinutes = Math.max(0, total - protectedMinutes - workMinutes);

  $("#loggedTotal").textContent = formatDuration(total);
  $("#protectedTotal").textContent = formatDuration(protectedMinutes);
  $("#workTotal").textContent = formatDuration(workMinutes);
  $("#otherTotal").textContent = formatDuration(otherMinutes);
}

function renderLogs() {
  const logs = state.logs
    .filter((log) => log.date === selectedDate)
    .sort((a, b) => a.start.localeCompare(b.start));

  const track = $("#timelineTrack");
  track.innerHTML = "";
  track.addEventListener("dragover", allowTimelineDrop);
  track.addEventListener("drop", dropNativeTimelineDrag);
  const rows = new Map();

  for (let hour = dayStartHour; hour < dayEndHour; hour += 1) {
    const row = document.createElement("div");
    row.className = "hour-row";
    row.innerHTML = `
      <div class="hour-label">${String(hour).padStart(2, "0")}</div>
      <div class="hour-slots" data-hour="${hour}">
        <div class="hour-cell"></div>
        <div class="hour-cell"></div>
        <div class="hour-cell"></div>
        <div class="hour-cell"></div>
        <div class="hour-cell"></div>
        <div class="hour-cell"></div>
      </div>
    `;
    rows.set(hour, row.querySelector(".hour-slots"));
    track.append(row);
  }

  logs.forEach((log) => {
    renderLogSegments(log, rows);
  });

  const list = $("#logList");
  list.innerHTML = "";
  if (!logs.length) {
    list.innerHTML = `<div class="empty-state">今天还没有时间记录。</div>`;
    return;
  }

  logs.forEach((log) => {
    const item = document.createElement("div");
    item.className = "log-item";
    item.innerHTML = `
      <time>${log.start}-${log.end}</time>
      <strong>${escapeHtml(log.title)}</strong>
      <div class="log-actions">
        <span class="tag">${categoryLabels[log.category]}</span>
        <button class="edit-button" type="button">修改</button>
        <button class="delete-button" type="button">删除</button>
      </div>
    `;
    item.querySelector(".edit-button").addEventListener("click", () => startLogEdit(log.id));
    item.querySelector(".delete-button").addEventListener("click", () => {
      state.logs = state.logs.filter((entry) => entry.id !== log.id);
      saveState();
      render();
    });
    list.append(item);
  });
}

function renderLogSegments(log, rows) {
  const dayStart = dayStartHour * 60;
  const dayEnd = dayEndHour * 60;
  const clippedStart = Math.max(dayStart, parseMinutes(log.start));
  const clippedEnd = Math.min(dayEnd, parseMinutes(log.end));
  if (clippedEnd <= clippedStart) return;

  for (let hour = Math.floor(clippedStart / 60); hour <= Math.floor((clippedEnd - 1) / 60); hour += 1) {
    const slot = rows.get(hour);
    if (!slot) continue;
    const segmentStart = Math.max(clippedStart, hour * 60);
    const segmentEnd = Math.min(clippedEnd, (hour + 1) * 60);
    const segment = document.createElement("button");
    segment.type = "button";
    segment.className = `time-segment ${log.category}`;
    segment.dataset.id = log.id;
    segment.draggable = true;
    segment.style.left = `${((segmentStart - hour * 60) / 60) * 100}%`;
    segment.style.width = `${Math.max(5, ((segmentEnd - segmentStart) / 60) * 100)}%`;
    segment.title = `${log.title} ${log.start}-${log.end}`;
    segment.innerHTML = `
      <strong>${escapeHtml(log.title)}</strong>
      <span>${log.start}-${log.end}</span>
    `;
    segment.addEventListener("dblclick", () => startLogEdit(log.id));
    segment.addEventListener("pointerdown", startTimelineDrag);
    segment.addEventListener("pointermove", moveTimelineDrag);
    segment.addEventListener("pointerup", endTimelineDrag);
    segment.addEventListener("pointercancel", cancelTimelineDrag);
    segment.addEventListener("mousedown", startTimelineMouseDrag);
    segment.addEventListener("dragstart", startNativeTimelineDrag);
    segment.addEventListener("dragend", endNativeTimelineDrag);
    slot.append(segment);
  }
}

function resetLogForm() {
  editingLogId = null;
  $("#logForm").reset();
  $("#logDate").value = selectedDate;
  $("#logSubmitButton").textContent = "记录时间";
  $("#cancelEditLogButton").classList.add("is-hidden");
}

function startLogEdit(id) {
  const log = state.logs.find((entry) => entry.id === id);
  if (!log) return;
  editingLogId = id;
  const form = $("#logForm");
  form.elements.date.value = log.date;
  form.elements.start.value = log.start;
  form.elements.end.value = log.end;
  form.elements.title.value = log.title;
  form.elements.category.value = log.category;
  form.elements.energy.value = String(log.energy);
  $("#logSubmitButton").textContent = "保存修改";
  $("#cancelEditLogButton").classList.remove("is-hidden");
  form.scrollIntoView({ block: "center", behavior: "smooth" });
}

function startTimelineDrag(event) {
  if (event.button !== 0) return;
  const id = event.currentTarget.dataset.id;
  const log = state.logs.find((entry) => entry.id === id);
  if (!log) return;

  activeDrag = {
    id,
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    moved: false,
    duration: minutesBetween(log.start, log.end),
    element: event.currentTarget,
  };
  event.currentTarget.setPointerCapture(event.pointerId);
  event.currentTarget.classList.add("is-dragging");
}

function startTimelineMouseDrag(event) {
  if (event.button !== 0 || activeDrag) return;
  const id = event.currentTarget.dataset.id;
  const log = state.logs.find((entry) => entry.id === id);
  if (!log) return;

  activeDrag = {
    id,
    pointerId: "mouse",
    startX: event.clientX,
    startY: event.clientY,
    moved: false,
    duration: minutesBetween(log.start, log.end),
    element: event.currentTarget,
  };
  event.currentTarget.classList.add("is-dragging");
  document.addEventListener("mousemove", moveTimelineMouseDrag);
  document.addEventListener("mouseup", endTimelineMouseDrag, { once: true });
  event.preventDefault();
}

function startNativeTimelineDrag(event) {
  const id = event.currentTarget.dataset.id;
  const log = state.logs.find((entry) => entry.id === id);
  if (!log) return;

  activeDrag = {
    id,
    pointerId: "native",
    startX: event.clientX,
    startY: event.clientY,
    moved: true,
    duration: minutesBetween(log.start, log.end),
    element: event.currentTarget,
  };
  event.currentTarget.classList.add("is-dragging");
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", id);
}

function moveTimelineDrag(event) {
  if (!activeDrag || activeDrag.pointerId !== event.pointerId) return;
  const distance = Math.abs(event.clientX - activeDrag.startX) + Math.abs(event.clientY - activeDrag.startY);
  if (distance > 5) activeDrag.moved = true;
}

function moveTimelineMouseDrag(event) {
  if (!activeDrag || activeDrag.pointerId !== "mouse") return;
  const distance = Math.abs(event.clientX - activeDrag.startX) + Math.abs(event.clientY - activeDrag.startY);
  if (distance > 5) activeDrag.moved = true;
}

function endTimelineDrag(event) {
  if (!activeDrag || activeDrag.pointerId !== event.pointerId) return;
  const drag = activeDrag;
  activeDrag = null;
  drag.element.classList.remove("is-dragging");
  if (drag.element.hasPointerCapture?.(event.pointerId)) {
    drag.element.releasePointerCapture(event.pointerId);
  }
  if (!drag.moved) return;

  finishTimelineDrag(drag, event.clientX, event.clientY);
}

function endTimelineMouseDrag(event) {
  document.removeEventListener("mousemove", moveTimelineMouseDrag);
  if (!activeDrag || activeDrag.pointerId !== "mouse") return;
  const drag = activeDrag;
  activeDrag = null;
  drag.element.classList.remove("is-dragging");
  if (!drag.moved) return;

  finishTimelineDrag(drag, event.clientX, event.clientY);
}

function allowTimelineDrop(event) {
  if (!activeDrag || activeDrag.pointerId !== "native") return;
  event.preventDefault();
  event.dataTransfer.dropEffect = "move";
}

function dropNativeTimelineDrag(event) {
  if (!activeDrag || activeDrag.pointerId !== "native") return;
  event.preventDefault();
  const drag = activeDrag;
  activeDrag = null;
  drag.element.classList.remove("is-dragging");
  finishTimelineDrag(drag, event.clientX, event.clientY);
}

function endNativeTimelineDrag() {
  if (!activeDrag || activeDrag.pointerId !== "native") return;
  activeDrag.element.classList.remove("is-dragging");
  activeDrag = null;
}

function finishTimelineDrag(drag, clientX, clientY) {
  const startMinutes = getTimelineMinutesFromPoint(clientX, clientY, drag.duration);
  const log = state.logs.find((entry) => entry.id === drag.id);
  if (!log) return;
  log.start = minutesToTime(startMinutes);
  log.end = minutesToTime(startMinutes + drag.duration);
  saveState();
  render();
}

function cancelTimelineDrag(event) {
  if (!activeDrag || activeDrag.pointerId !== event.pointerId) return;
  activeDrag.element.classList.remove("is-dragging");
  activeDrag = null;
}

function getTimelineMinutesFromPoint(clientX, clientY, duration) {
  const track = $("#timelineTrack");
  const rect = track.getBoundingClientRect();
  const rowCount = dayEndHour - dayStartHour;
  const rowHeight = rect.height / rowCount;
  const rowIndex = clamp(Math.floor((clientY - rect.top) / rowHeight), 0, rowCount - 1);
  const hour = dayStartHour + rowIndex;
  const slotsLeft = rect.left + 54;
  const slotsWidth = Math.max(1, rect.width - 54);
  const x = clamp(clientX - slotsLeft, 0, slotsWidth);
  const minute = clamp(Math.round(((x / slotsWidth) * 60) / 10) * 10, 0, 50);
  const maxStart = dayEndHour * 60 - duration;
  return clamp(hour * 60 + minute, dayStartHour * 60, maxStart);
}

function minutesToTime(minutes) {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function renderCalendar() {
  const label = new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "long",
  }).format(visibleMonth);
  $("#monthLabel").textContent = label;

  const grid = $("#calendarGrid");
  grid.innerHTML = "";

  const first = new Date(visibleMonth);
  const firstDay = first.getDay() === 0 ? 7 : first.getDay();
  const gridStart = addDays(first, -(firstDay - 1));

  for (let index = 0; index < 42; index += 1) {
    const date = addDays(gridStart, index);
    const key = toDateKey(date);
    const dayEvents = state.events.filter((event) => event.date === key);
    const dayReminders = state.reminders.filter((reminder) => reminder.date === key && !reminder.done);
    const cell = document.createElement("button");
    cell.type = "button";
    cell.className = [
      "day-cell",
      date.getMonth() !== visibleMonth.getMonth() ? "is-muted" : "",
      key === toDateKey(today) ? "is-today" : "",
      key === selectedDate ? "is-selected" : "",
    ].join(" ");
    cell.innerHTML = `
      <span class="day-number">${date.getDate()}</span>
      ${dayEvents.slice(0, 2).map((event) => `<span class="day-pill ${event.type}">${escapeHtml(event.title)}</span>`).join("")}
      ${dayReminders.slice(0, 1).map((reminder) => `<span class="day-pill rest">${escapeHtml(reminder.title)}</span>`).join("")}
    `;
    cell.addEventListener("click", () => {
      selectedDate = key;
      $("#logDate").value = key;
      $("#eventDate").value = key;
      $("#reminderDate").value = key;
      render();
    });
    grid.append(cell);
  }
}

function renderEventsForSelectedDate() {
  const events = state.events
    .filter((event) => event.date === selectedDate)
    .sort((a, b) => (a.time || "99:99").localeCompare(b.time || "99:99"));
  const list = $("#eventList");
  list.innerHTML = "";

  if (!events.length) {
    list.innerHTML = `<div class="empty-state">${formatDateLabel(selectedDate)} 暂无日历安排。</div>`;
    return;
  }

  events.forEach((event) => {
    const item = document.createElement("div");
    item.className = "event-item";
    item.innerHTML = `
      <div class="event-meta">${event.time || "全天"}</div>
      <strong>${escapeHtml(event.title)}</strong>
      <div class="log-actions">
        <span class="tag">${eventLabels[event.type]}</span>
        <button class="delete-button" type="button">删除</button>
      </div>
    `;
    item.querySelector(".delete-button").addEventListener("click", () => {
      state.events = state.events.filter((entry) => entry.id !== event.id);
      saveState();
      renderCalendar();
      renderEventsForSelectedDate();
    });
    list.append(item);
  });
}

function renderReminders() {
  const reminders = [...state.reminders].sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`));
  const list = $("#reminderList");
  list.innerHTML = "";
  if (!reminders.length) {
    list.innerHTML = `<div class="empty-state">暂无提醒事项。</div>`;
    return;
  }

  reminders.forEach((reminder) => {
    const item = document.createElement("div");
    item.className = `reminder-item ${reminder.done ? "is-done" : ""}`;
    item.innerHTML = `
      <button type="button" aria-label="切换完成状态"></button>
      <div>
        <strong>${escapeHtml(reminder.title)}</strong>
        <div class="reminder-meta">${formatDateLabel(reminder.date)} ${reminder.time || ""}</div>
      </div>
      <button class="delete-button" type="button">删除</button>
    `;
    item.querySelector("button").addEventListener("click", () => {
      reminder.done = !reminder.done;
      saveState();
      renderReminders();
      renderCalendar();
    });
    item.querySelector(".delete-button").addEventListener("click", () => {
      state.reminders = state.reminders.filter((entry) => entry.id !== reminder.id);
      saveState();
      renderReminders();
      renderCalendar();
    });
    list.append(item);
  });
}

function renderNotes() {
  $("#selectedDateLabel").textContent = formatDateLabel(selectedDate);
  $("#dayNote").value = state.notes[selectedDate] || "";
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

init();
