/* =========================================================
   HANAMI — EXPENSE TRACKER
   script.js

   Sections:
   1. Helpers & constants
   2. State (load / persist)
   3. Theme
   4. Navigation
   5. Sakura petal background animation
   6. Date-range filter
   7. Recurring expenses (auto-instantiation + management)
   8. Bulk selection & delete
   9. Rendering (list, totals, mom compare, charts, trend, reports, insights, streaks)
   10. Expense form (add + edit)
   11. Quick-add chips
   12. Goal & category budget forms
   12. AI assistant (Claude API — natural language quick-add + category suggest)
   13. Export (CSV + PDF)
   14. Backup & restore (JSON)
   15. Toast notifications (with undo)
   16. Init
   ========================================================= */

/* ---------------------------------------------------------
   1. HELPERS & CONSTANTS
   --------------------------------------------------------- */
const qs = id => document.getElementById(id);

const CATEGORIES = ["Food", "Travel", "Shopping", "Bills", "Other"];

const CATEGORY_COLORS = {
  Food:     "#ff6f9c",
  Travel:   "#7dd3c0",
  Shopping: "#ffd166",
  Bills:    "#9d8df1",
  Other:    "#b9b6d9"
};

const STORAGE_KEYS = {
  expenses: "tracker_expenses",
  goal: "tracker_goal",
  theme: "tracker_theme",
  recurring: "tracker_recurring",
  categoryBudgets: "tracker_category_budgets",
  lastEntryDate: "tracker_last_entry_date",
  streak: "tracker_streak"
};

const DAY_MS = 24 * 60 * 60 * 1000;

function formatRupees(n) {
  // guard against NaN/undefined so the UI never shows "₹NaN"
  const safe = Number.isFinite(n) ? n : 0;
  return "₹" + safe.toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function startOfWeek(d) {
  // Monday-start week
  const date = new Date(d);
  const day = (date.getDay() + 6) % 7; // 0 = Monday
  date.setDate(date.getDate() - day);
  date.setHours(0, 0, 0, 0);
  return date;
}

function startOfMonth(d) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

/* ---------------------------------------------------------
   2. STATE
   --------------------------------------------------------- */
let expenses = [];
let goal = 15000;
let recurringItems = [];      // [{ id, name, amount, category, frequency, lastAdded }]
let categoryBudgets = {};     // { Food: 3000, Travel: 1500, ... }
let chartInstance = null;
let trendChartInstance = null;
let activeRange = "week";     // "week" | "month" | "all"
let pendingUndo = null;       // { expense } — last deleted item, for undo
let selectedIds = new Set();  // ids currently checked for bulk delete

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.expenses);
    const parsed = raw ? JSON.parse(raw) : [];
    expenses = Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.warn("Couldn't read saved expenses, starting fresh.", err);
    expenses = [];
  }

  const savedGoal = Number(localStorage.getItem(STORAGE_KEYS.goal));
  goal = Number.isFinite(savedGoal) && savedGoal > 0 ? savedGoal : 15000;

  try {
    const rawRecurring = localStorage.getItem(STORAGE_KEYS.recurring);
    const parsedRecurring = rawRecurring ? JSON.parse(rawRecurring) : [];
    recurringItems = Array.isArray(parsedRecurring) ? parsedRecurring : [];
  } catch (err) {
    recurringItems = [];
  }

  try {
    const rawBudgets = localStorage.getItem(STORAGE_KEYS.categoryBudgets);
    categoryBudgets = rawBudgets ? JSON.parse(rawBudgets) : {};
  } catch (err) {
    categoryBudgets = {};
  }
}

function persist() {
  try {
    localStorage.setItem(STORAGE_KEYS.expenses, JSON.stringify(expenses));
    localStorage.setItem(STORAGE_KEYS.goal, String(goal));
    localStorage.setItem(STORAGE_KEYS.recurring, JSON.stringify(recurringItems));
    localStorage.setItem(STORAGE_KEYS.categoryBudgets, JSON.stringify(categoryBudgets));
  } catch (err) {
    // most likely quota exceeded or storage disabled (private browsing)
    showToast("⚠️ Couldn't save — storage might be full or disabled", { danger: true });
  }
}

/* ---------------------------------------------------------
   3. THEME (dark / light)
   --------------------------------------------------------- */
function initTheme() {
  const saved = localStorage.getItem(STORAGE_KEYS.theme) || "dark";
  applyTheme(saved);

  qs("themeToggle").addEventListener("click", () => {
    const current = document.documentElement.getAttribute("data-theme") || "dark";
    const next = current === "dark" ? "light" : "dark";
    applyTheme(next);
    localStorage.setItem(STORAGE_KEYS.theme, next);
  });
}

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  qs("themeIcon").textContent = theme === "dark" ? "🌙" : "☀️";
  qs("themeLabel").textContent = theme === "dark" ? "Dark mode" : "Light mode";
  // chart legend text color depends on theme — repaint if it exists
  if (chartInstance) renderChart();
}

/* ---------------------------------------------------------
   4. NAVIGATION
   --------------------------------------------------------- */
function initNavigation() {
  document.querySelectorAll(".nav").forEach(btn => {
    btn.addEventListener("click", () => goToPage(btn.dataset.page));
  });
}

function goToPage(pageId) {
  document.querySelectorAll(".nav").forEach(n =>
    n.classList.toggle("active", n.dataset.page === pageId)
  );

  document.querySelectorAll(".page").forEach(p =>
    p.classList.toggle("hidden", p.id !== pageId)
  );

  // re-render whenever we land on a data-driven page so it's always fresh
  if (pageId === "dashboard" || pageId === "reports" || pageId === "goals" || pageId === "expense") {
    render();
  }
}

/* ---------------------------------------------------------
   5. SAKURA PETAL BACKGROUND
   Lightweight canvas animation — decorative only, paused
   automatically if the user prefers reduced motion.
   --------------------------------------------------------- */
function initPetals() {
  const canvas = qs("petals");
  const ctx = canvas.getContext("2d");
  const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  let petals = [];

  function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }

  function makePetal() {
    return {
      x: Math.random() * canvas.width,
      y: Math.random() * -canvas.height,
      r: 6 + Math.random() * 8,
      speedY: 0.4 + Math.random() * 0.6,
      speedX: Math.sin(Math.random() * Math.PI),
      sway: Math.random() * Math.PI * 2,
      opacity: 0.25 + Math.random() * 0.35
    };
  }

  resize();
  window.addEventListener("resize", resize);

  if (prefersReducedMotion) return; // skip animation entirely

  const count = window.innerWidth < 768 ? 14 : 26;
  petals = Array.from({ length: count }, makePetal);

  function tick() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    petals.forEach(p => {
      p.y += p.speedY;
      p.sway += 0.02;
      p.x += Math.sin(p.sway) * 0.6;

      if (p.y > canvas.height + 20) {
        Object.assign(p, makePetal(), { y: -20 });
      }

      ctx.save();
      ctx.globalAlpha = p.opacity;
      ctx.fillStyle = "#ff9fbd";
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, p.r, p.r * 0.6, p.sway, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });

    requestAnimationFrame(tick);
  }

  requestAnimationFrame(tick);
}

/* ---------------------------------------------------------
   6. DATE-RANGE FILTER
   Pills on the dashboard: This week / This month / All time.
   This is layered on top of the existing search filter.
   --------------------------------------------------------- */
function initRangeFilter() {
  document.querySelectorAll(".pill").forEach(btn => {
    btn.addEventListener("click", () => {
      activeRange = btn.dataset.range;
      document.querySelectorAll(".pill").forEach(p =>
        p.classList.toggle("active", p === btn)
      );
      render();
    });
  });
}

function isInActiveRange(dateStr) {
  if (activeRange === "all") return true;

  const d = new Date(dateStr);
  const now = new Date();

  if (activeRange === "week") return d >= startOfWeek(now);
  if (activeRange === "month") return d >= startOfMonth(now);
  return true;
}

/* ---------------------------------------------------------
   7. RECURRING EXPENSES
   A recurring item is a template. Each time the app loads,
   we check whether it's "due" and, if so, auto-insert a real
   expense row and stamp lastAdded so it won't double-fire.
   --------------------------------------------------------- */
function processDueRecurringExpenses() {
  const now = new Date();
  let addedAny = false;

  recurringItems.forEach(item => {
    const last = item.lastAdded ? new Date(item.lastAdded) : null;
    let due = false;

    if (!last) {
      due = true; // never run before
    } else if (item.frequency === "weekly") {
      due = (now - last) >= 7 * DAY_MS;
    } else { // monthly
      due = now.getFullYear() !== last.getFullYear() || now.getMonth() !== last.getMonth();
    }

    if (due) {
      expenses.unshift({
        id: Date.now() + Math.floor(Math.random() * 1000),
        name: item.name,
        amount: item.amount,
        category: item.category,
        date: now.toISOString(),
        recurringId: item.id
      });
      item.lastAdded = now.toISOString();
      addedAny = true;
    }
  });

  if (addedAny) persist();
}

function initRecurringForm() {
  const checkbox = qs("recurringCheck");
  const freqSelect = qs("recurringFrequency");

  checkbox.addEventListener("change", () => {
    freqSelect.classList.toggle("hidden", !checkbox.checked);
  });
}

function renderRecurringList() {
  const list = qs("recurringList");
  list.innerHTML = "";

  qs("recurringEmpty").classList.toggle("hidden", recurringItems.length > 0);

  recurringItems.forEach(item => {
    const li = document.createElement("li");
    li.innerHTML = `
      <div class="exp-info">
        <span class="exp-name">${escapeHtml(item.name)}</span>
        <span class="exp-meta">${formatRupees(item.amount)} · ${escapeHtml(item.category)}
          <span class="recurring-freq-pill">${item.frequency === "weekly" ? "Weekly" : "Monthly"}</span>
        </span>
      </div>`;

    const stopBtn = document.createElement("button");
    stopBtn.className = "icon-btn";
    stopBtn.title = "Stop recurring";
    stopBtn.textContent = "⏹️";
    stopBtn.addEventListener("click", () => stopRecurring(item.id));

    li.appendChild(stopBtn);
    list.appendChild(li);
  });
}

function stopRecurring(id) {
  recurringItems = recurringItems.filter(r => r.id !== id);
  persist();
  renderRecurringList();
  showToast("⏹️ Recurring expense stopped");
}

/* ---------------------------------------------------------
   8. BULK SELECTION & DELETE
   Checkboxes on the expense list let multiple entries be
   removed in one action instead of one tap at a time.
   --------------------------------------------------------- */
function initBulkActions() {
  qs("selectAllCheck").addEventListener("change", e => {
    const visible = getFilteredExpenses();
    if (e.target.checked) {
      visible.forEach(exp => selectedIds.add(exp.id));
    } else {
      selectedIds.clear();
    }
    renderList();
    renderBulkBar();
  });

  qs("bulkDeleteBtn").addEventListener("click", bulkDeleteSelected);
}

function toggleSelected(id, checked) {
  if (checked) selectedIds.add(id);
  else selectedIds.delete(id);
  renderBulkBar();
}

function renderBulkBar() {
  const bar = qs("bulkBar");
  const count = selectedIds.size;

  bar.classList.toggle("hidden", count === 0);
  qs("selectedCount").textContent = `${count} selected`;

  const visible = getFilteredExpenses();
  const allSelected = visible.length > 0 && visible.every(e => selectedIds.has(e.id));
  qs("selectAllCheck").checked = allSelected;
}

function bulkDeleteSelected() {
  const count = selectedIds.size;
  if (count === 0) return;

  const confirmed = window.confirm(`Delete ${count} selected expense${count === 1 ? "" : "s"}? This can't be undone.`);
  if (!confirmed) return;

  expenses = expenses.filter(e => !selectedIds.has(e.id));
  selectedIds.clear();
  persist();
  render();
  showToast(`🗑️ Deleted ${count} expense${count === 1 ? "" : "s"}`);
}

/* ---------------------------------------------------------
   9. RENDERING
   --------------------------------------------------------- */
function render() {
  renderList();
  renderTotals();
  renderMomCompare();
  renderChart();
  renderTrendChart();
  renderReports();
  renderGoalText();
  renderCategoryBudgetRows();
  renderBudgetVsActual();
  renderRecurringList();
  renderQuickAddChips();
  renderInsight();
  renderStreak();
  renderBulkBar();
}

function getFilteredExpenses() {
  const q = qs("search").value.trim().toLowerCase();

  return expenses.filter(e => {
    const matchesSearch = !q || e.name.toLowerCase().includes(q);
    const matchesRange = isInActiveRange(e.date);
    return matchesSearch && matchesRange;
  });
}

function renderList() {
  const list = qs("list");
  const visible = getFilteredExpenses();

  // drop any selected ids that no longer exist (e.g. after a delete elsewhere)
  selectedIds.forEach(id => {
    if (!expenses.some(e => e.id === id)) selectedIds.delete(id);
  });

  list.innerHTML = "";
  qs("listEmpty").classList.toggle("hidden", visible.length > 0);

  visible.forEach(e => {
    const li = document.createElement("li");

    const left = document.createElement("div");
    left.className = "exp-row-left";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "exp-checkbox";
    checkbox.checked = selectedIds.has(e.id);
    checkbox.setAttribute("aria-label", `Select ${e.name}`);
    checkbox.addEventListener("change", () => toggleSelected(e.id, checkbox.checked));

    const info = document.createElement("div");
    info.className = "exp-info";
    info.innerHTML = `
      <span class="exp-name">${escapeHtml(e.name)}${e.recurringId ? " 🔁" : ""}</span>
      <span class="exp-meta">${formatRupees(e.amount)} · ${new Date(e.date).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
        <span class="cat-pill">${escapeHtml(e.category)}</span>
      </span>`;

    left.append(checkbox, info);

    const actions = document.createElement("div");
    actions.className = "exp-actions";

    const editBtn = document.createElement("button");
    editBtn.className = "icon-btn";
    editBtn.title = "Edit expense";
    editBtn.textContent = "✏️";
    editBtn.addEventListener("click", () => startEdit(e.id));

    const delBtn = document.createElement("button");
    delBtn.className = "icon-btn";
    delBtn.title = "Delete expense";
    delBtn.textContent = "🗑️";
    delBtn.addEventListener("click", () => deleteExpense(e.id));

    actions.append(editBtn, delBtn);
    li.append(left, actions);
    list.appendChild(li);
  });
}

function renderTotals() {
  const visible = getFilteredExpenses();
  const total = visible.reduce((sum, e) => sum + e.amount, 0);

  qs("total").textContent = formatRupees(total);

  const remaining = goal - total;
  const savingEl = qs("saving");

  if (remaining < 0) {
    savingEl.textContent = `⚠️ Over budget by ${formatRupees(Math.abs(remaining))}`;
    savingEl.classList.add("over");
  } else {
    savingEl.textContent = `You've got ${formatRupees(remaining)} left to spend 🌿`;
    savingEl.classList.remove("over");
  }

  const pct = goal > 0 ? Math.min((total / goal) * 100, 100) : 0;
  qs("fill").style.width = pct + "%";
  qs("fill").parentElement.setAttribute("aria-valuenow", Math.round(pct));

  qs("goalTextSmall").textContent = `Goal ${formatRupees(goal)}`;
}

/* ---- month-over-month comparison ---- */
function renderMomCompare() {
  const el = qs("momCompare");
  const now = new Date();
  const dayOfMonth = now.getDate();

  const thisMonthStart = startOfMonth(now);
  const lastMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastMonthStart = startOfMonth(lastMonthDate);
  // compare only up to the same day-of-month last month, so a half-finished
  // current month isn't unfairly compared against a full previous month
  const lastMonthSameDayCutoff = new Date(lastMonthDate.getFullYear(), lastMonthDate.getMonth(), dayOfMonth, 23, 59, 59);

  const thisMonthSoFar = expenses
    .filter(e => new Date(e.date) >= thisMonthStart)
    .reduce((s, e) => s + e.amount, 0);

  const lastMonthSameWindow = expenses
    .filter(e => {
      const d = new Date(e.date);
      return d >= lastMonthStart && d <= lastMonthSameDayCutoff;
    })
    .reduce((s, e) => s + e.amount, 0);

  if (lastMonthSameWindow <= 0) {
    el.classList.add("hidden");
    return;
  }

  const diff = thisMonthSoFar - lastMonthSameWindow;
  const pct = Math.round((Math.abs(diff) / lastMonthSameWindow) * 100);

  el.classList.remove("hidden");
  el.classList.remove("better", "worse");

  if (diff <= 0) {
    el.textContent = `↓ ${pct}% less than this point last month`;
    el.classList.add("better");
  } else {
    el.textContent = `↑ ${pct}% more than this point last month`;
    el.classList.add("worse");
  }
}

function renderChart() {
  const visible = getFilteredExpenses();
  const stats = {};

  visible.forEach(e => {
    stats[e.category] = (stats[e.category] || 0) + e.amount;
  });

  const labels = Object.keys(stats);
  const hasData = labels.length > 0;

  qs("chartEmpty").classList.toggle("hidden", hasData);
  qs("chart").classList.toggle("hidden", !hasData);

  // always destroy the previous instance before creating a new one —
  // this avoids the memory-leak / stale-chart bug from re-rendering
  if (chartInstance) {
    chartInstance.destroy();
    chartInstance = null;
  }

  if (!hasData) return;

  chartInstance = new Chart(qs("chart"), {
    type: "doughnut",
    data: {
      labels,
      datasets: [{
        data: Object.values(stats),
        backgroundColor: labels.map(l => CATEGORY_COLORS[l] || "#b9b6d9"),
        borderWidth: 0,
        hoverOffset: 8
      }]
    },
    options: {
      plugins: {
        legend: {
          position: "bottom",
          labels: { color: getComputedStyle(document.body).getPropertyValue("--text").trim() || "#fff" }
        }
      },
      cutout: "62%"
    }
  });
}

/* ---- 6-month spending trend (Reports page) ---- */
function renderTrendChart() {
  const now = new Date();
  const months = [];

  // build the last 6 calendar months, oldest first
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(d);
  }

  const totals = months.map(monthDate => {
    return expenses
      .filter(e => {
        const d = new Date(e.date);
        return d.getFullYear() === monthDate.getFullYear() && d.getMonth() === monthDate.getMonth();
      })
      .reduce((s, e) => s + e.amount, 0);
  });

  const hasData = totals.some(t => t > 0);

  qs("trendEmpty").classList.toggle("hidden", hasData);
  qs("trendChart").classList.toggle("hidden", !hasData);

  if (trendChartInstance) {
    trendChartInstance.destroy();
    trendChartInstance = null;
  }

  if (!hasData) return;

  const textColor = getComputedStyle(document.body).getPropertyValue("--text").trim() || "#fff";
  const dimColor = getComputedStyle(document.body).getPropertyValue("--text-dim").trim() || "#aaa";
  const gridColor = getComputedStyle(document.body).getPropertyValue("--border").trim() || "rgba(255,255,255,.14)";

  trendChartInstance = new Chart(qs("trendChart"), {
    type: "line",
    data: {
      labels: months.map(d => d.toLocaleDateString("en-IN", { month: "short" })),
      datasets: [{
        data: totals,
        borderColor: "#ff6f9c",
        backgroundColor: "rgba(255,111,156,.15)",
        pointBackgroundColor: "#ff6f9c",
        pointRadius: 4,
        tension: 0.35,
        fill: true
      }]
    },
    options: {
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: dimColor }, grid: { color: "transparent" } },
        y: {
          ticks: { color: dimColor, callback: v => "₹" + v },
          grid: { color: gridColor },
          beginAtZero: true
        }
      }
    }
  });
}

function renderReports() {
  const now = new Date();
  const currentYear = now.getFullYear();

  const monthly = expenses.filter(e => {
    const d = new Date(e.date);
    return d.getMonth() === currentMonth && d.getFullYear() === currentYear;
  });

  qs("monthlyReport").textContent =
    `${monthly.length} expense${monthly.length === 1 ? "" : "s"} this month · ${formatRupees(monthly.reduce((s, e) => s + e.amount, 0))} total`;

  const map = {};
  monthly.forEach(e => {
    map[e.category] = (map[e.category] || 0) + e.amount;
  });

  const breakdown = qs("breakdown");
  const entries = Object.entries(map).sort((a, b) => b[1] - a[1]);

  breakdown.innerHTML = entries.length
    ? entries.map(([cat, amt]) => `
        <div class="breakdown-row">
          <span>${escapeHtml(cat)}</span>
          <span class="amt">${formatRupees(amt)}</span>
        </div>`).join("")
    : `<p class="empty-hint">No expenses logged this month yet 🍃</p>`;
}

function renderGoalText() {
  qs("goalText").textContent = `Current goal: ${formatRupees(goal)}`;
}

/* ---- per-category budgets (Goals page) ---- */
function renderCategoryBudgetRows() {
  const container = qs("categoryBudgetRows");
  container.innerHTML = CATEGORIES.map(cat => `
    <div class="cat-budget-row">
      <label for="catBudget-${cat}">
        <span class="cat-dot" style="background:${CATEGORY_COLORS[cat]}"></span>
        ${escapeHtml(cat)}
      </label>
      <input
        type="number" min="0" step="0.01"
        id="catBudget-${cat}"
        data-category="${cat}"
        placeholder="No limit"
        value="${categoryBudgets[cat] ?? ""}">
    </div>
  `).join("");

  container.querySelectorAll("input[data-category]").forEach(input => {
    input.addEventListener("change", () => {
      const cat = input.dataset.category;
      const val = Number(input.value);

      if (!input.value || !Number.isFinite(val) || val <= 0) {
        delete categoryBudgets[cat];
      } else {
        categoryBudgets[cat] = val;
      }

      persist();
      renderBudgetVsActual();
      showToast(`✅ ${cat} budget updated`);
    });
  });
}

/* ---- budget vs actual (Reports page) ---- */
function renderBudgetVsActual() {
  const container = qs("budgetVsActual");
  const categoriesWithBudgets = Object.keys(categoryBudgets);

  qs("budgetVsActualEmpty").classList.toggle("hidden", categoriesWithBudgets.length > 0);
  if (categoriesWithBudgets.length === 0) {
    container.innerHTML = "";
    return;
  }

  const now = new Date();
  const monthly = expenses.filter(e => {
    const d = new Date(e.date);
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  });

  container.innerHTML = categoriesWithBudgets.map(cat => {
    const spent = monthly.filter(e => e.category === cat).reduce((s, e) => s + e.amount, 0);
    const budget = categoryBudgets[cat];
    const pct = Math.min((spent / budget) * 100, 100);
    const isOver = spent > budget;

    return `
      <div class="bva-row">
        <div class="bva-top">
          <span>${escapeHtml(cat)}</span>
          <span class="bva-amounts">${formatRupees(spent)} / ${formatRupees(budget)}</span>
        </div>
        <div class="bva-bar">
          <div class="bva-fill ${isOver ? "over" : "under"}" style="width:${pct}%"></div>
        </div>
      </div>`;
  }).join("");
}

/* ---- smart insight banner ---- */
function renderInsight() {
  const banner = qs("insightBanner");
  const insight = computeInsight();

  if (!insight) {
    banner.classList.add("hidden");
    return;
  }

  qs("insightText").textContent = insight;
  banner.classList.remove("hidden");
}

function computeInsight() {
  if (expenses.length === 0) return null;

  const now = new Date();

  // 1. days-left-in-month budget pacing, if a goal is set
  const monthStart = startOfMonth(now);
  const monthSpent = expenses
    .filter(e => new Date(e.date) >= monthStart)
    .reduce((s, e) => s + e.amount, 0);

  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const daysLeft = daysInMonth - now.getDate();
  const remaining = goal - monthSpent;

  if (remaining > 0 && daysLeft > 0) {
    const perDay = remaining / daysLeft;
    return `${daysLeft} day${daysLeft === 1 ? "" : "s"} left this month — that's ${formatRupees(perDay)}/day to stay on budget.`;
  }
  if (remaining <= 0) {
    return `You've gone ${formatRupees(Math.abs(remaining))} over this month's goal. Consider checking Reports for where it went.`;
  }

  // 2. category spike vs weekly average (fallback if no goal signal applies)
  const thisWeekStart = startOfWeek(now);
  const lastWeekStart = new Date(thisWeekStart.getTime() - 7 * DAY_MS);

  const thisWeek = expenses.filter(e => new Date(e.date) >= thisWeekStart);
  const lastWeek = expenses.filter(e => {
    const d = new Date(e.date);
    return d >= lastWeekStart && d < thisWeekStart;
  });

  if (thisWeek.length && lastWeek.length) {
    const byCat = (list) => {
      const m = {};
      list.forEach(e => { m[e.category] = (m[e.category] || 0) + e.amount; });
      return m;
    };
    const thisMap = byCat(thisWeek);
    const lastMap = byCat(lastWeek);

    let biggestJumpCat = null, biggestJumpPct = 0;
    Object.keys(thisMap).forEach(cat => {
      if (lastMap[cat] && lastMap[cat] > 0) {
        const pct = ((thisMap[cat] - lastMap[cat]) / lastMap[cat]) * 100;
        if (pct > biggestJumpPct) {
          biggestJumpPct = pct;
          biggestJumpCat = cat;
        }
      }
    });

    if (biggestJumpCat && biggestJumpPct >= 20) {
      return `You've spent ${Math.round(biggestJumpPct)}% more on ${biggestJumpCat} this week compared to last week.`;
    }
  }

  return null;
}

/* ---- streaks ---- */
function renderStreak() {
  const streak = computeStreak();
  const badge = qs("streakBadge");

  if (streak < 2) {
    badge.classList.add("hidden");
    return;
  }

  qs("streakCount").textContent = `${streak} day streak`;
  badge.classList.remove("hidden");
}

function computeStreak() {
  // a "streak day" = a day where total spend stayed under the
  // average daily budget implied by the goal (goal / days in month).
  const now = new Date();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const dailyBudget = goal / daysInMonth;

  const spendByDay = {};
  expenses.forEach(e => {
    const d = new Date(e.date);
    const key = d.toDateString();
    spendByDay[key] = (spendByDay[key] || 0) + e.amount;
  });

  let streak = 0;
  for (let i = 0; i < 60; i++) {
    const day = new Date(now);
    day.setDate(now.getDate() - i);
    const key = day.toDateString();
    const spent = spendByDay[key];

    if (spent === undefined) {
      // no entries that day — don't break the streak for today specifically
      // (it just hasn't happened yet), but break it for past days
      if (i === 0) continue;
      break;
    }
    if (spent <= dailyBudget) {
      streak++;
    } else {
      break;
    }
  }
  return streak;
}

/* ---------------------------------------------------------
   9. EXPENSE FORM (add + edit)
   --------------------------------------------------------- */
function initExpenseForm() {
  const form = qs("expenseForm");

  form.addEventListener("submit", e => {
    e.preventDefault();
    saveExpenseFromForm();
  });

  qs("cancelEditBtn").addEventListener("click", () => resetExpenseForm());
}

function saveExpenseFromForm() {
  const name = qs("expenseName").value.trim();
  const amount = Number(qs("expenseAmount").value);
  const category = qs("expenseCategory").value;
  const editId = qs("editId").value;
  const isRecurring = qs("recurringCheck").checked;
  const frequency = qs("recurringFrequency").value;

  if (!name) {
    showToast("⚠️ Give your expense a name", { danger: true });
    return;
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    showToast("⚠️ Enter an amount greater than 0", { danger: true });
    return;
  }

  if (editId) {
    // editing an existing expense
    const target = expenses.find(x => String(x.id) === editId);
    if (target) {
      target.name = name;
      target.amount = amount;
      target.category = category;
    }
    showToast("✅ Expense updated");
  } else {
    // adding a new expense — use the AI-parsed date if the natural
    // language quick-add set one, otherwise it happened just now
    const aiDate = qs("expenseForm").dataset.aiDate;
    const expenseDate = aiDate || new Date().toISOString();

    expenses.unshift({
      id: Date.now(),
      name,
      amount,
      category,
      date: expenseDate
    });

    // also register as a recurring template if requested
    if (isRecurring) {
      recurringItems.push({
        id: Date.now() + 1,
        name,
        amount,
        category,
        frequency,
        lastAdded: new Date().toISOString() // already added once, just now
      });
    }

    showToast(isRecurring ? "✅ Saved & set to repeat 🔁" : "✅ Expense saved");
  }

  persist();
  resetExpenseForm();
  render();
  goToPage("dashboard");
}

function startEdit(id) {
  const target = expenses.find(e => e.id === id);
  if (!target) return;

  qs("editId").value = target.id;
  delete qs("expenseForm").dataset.aiDate;
  qs("expenseName").value = target.name;
  qs("expenseAmount").value = target.amount;
  qs("expenseCategory").value = target.category;
  qs("recurringCheck").checked = false;
  qs("recurringCheck").parentElement.classList.add("hidden"); // can't toggle recurring while editing a single entry
  qs("recurringFrequency").classList.add("hidden");

  qs("formEyebrow").textContent = "Editing entry";
  qs("formHeading").textContent = "Edit expense ✏️";
  qs("addExpenseBtn").textContent = "Update Expense ✏️";
  qs("cancelEditBtn").classList.remove("hidden");

  goToPage("expense");
  qs("expenseName").focus();
}

function resetExpenseForm() {
  qs("expenseForm").reset();
  qs("editId").value = "";
  delete qs("expenseForm").dataset.aiDate;
  qs("recurringFrequency").classList.add("hidden");
  qs("recurringCheck").parentElement.classList.remove("hidden");

  qs("formEyebrow").textContent = "New entry";
  qs("formHeading").textContent = "Add an expense ✨";
  qs("addExpenseBtn").textContent = "Save Expense ✨";
  qs("cancelEditBtn").classList.add("hidden");
  qs("aiParseStatus").textContent = "";
  qs("aiParseStatus").className = "ai-parse-status";
}

function deleteExpense(id) {
  const target = expenses.find(e => e.id === id);
  if (!target) return;

  const index = expenses.findIndex(e => e.id === id);
  expenses = expenses.filter(e => e.id !== id);
  persist();
  render();

  // keep a copy + its original position so Undo can restore it exactly
  pendingUndo = { expense: target, index };
  showToast(`🗑️ Deleted "${target.name}"`, { undo: true });
}

function undoDelete() {
  if (!pendingUndo) return;
  const { expense, index } = pendingUndo;
  expenses.splice(Math.min(index, expenses.length), 0, expense);
  pendingUndo = null;
  persist();
  render();
  showToast("↩️ Restored");
}

/* ---------------------------------------------------------
   10. QUICK-ADD CHIPS
   Surfaces the 4 most frequently repeated expense names so
   common purchases are a single tap instead of a full form.
   --------------------------------------------------------- */
function renderQuickAddChips() {
  const row = qs("quickAddRow");
  const frequencyMap = {};

  expenses.forEach(e => {
    const key = e.name.trim().toLowerCase();
    if (!frequencyMap[key]) {
      frequencyMap[key] = { name: e.name, amount: e.amount, category: e.category, count: 0 };
    }
    frequencyMap[key].count++;
    frequencyMap[key].amount = e.amount; // keep most recent amount
  });

  const topChips = Object.values(frequencyMap)
    .filter(item => item.count >= 2) // only suggest things bought more than once
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  if (topChips.length === 0) {
    row.innerHTML = `<p class="quick-add-empty">Add a couple of expenses and your frequent ones will show up here for one-tap logging 🌱</p>`;
    return;
  }

  row.innerHTML = topChips.map((item, i) => `
    <button class="quick-chip" data-index="${i}">
      ${escapeHtml(item.name)}<span class="amt">${formatRupees(item.amount)}</span>
    </button>
  `).join("");

  row.querySelectorAll(".quick-chip").forEach((btn, i) => {
    btn.addEventListener("click", () => quickAdd(topChips[i]));
  });
}

function quickAdd(item) {
  expenses.unshift({
    id: Date.now(),
    name: item.name,
    amount: item.amount,
    category: item.category,
    date: new Date().toISOString()
  });
  persist();
  render();
  showToast(`✅ Added "${item.name}" — ${formatRupees(item.amount)}`);
}

/* ---------------------------------------------------------
   11. GOAL & CATEGORY BUDGET FORMS
   --------------------------------------------------------- */
function initGoalForm() {
  qs("saveGoalBtn").addEventListener("click", () => {
    const g = Number(qs("goalInput").value);

    if (!Number.isFinite(g) || g <= 0) {
      showToast("⚠️ Enter a goal greater than 0", { danger: true });
      return;
    }

    goal = g;
    persist();
    qs("goalInput").value = "";
    render();
    showToast("🎯 Goal saved");
  });
}

/* ---------------------------------------------------------
   12. AI ASSISTANT (Claude API — bring-your-own-key)
   This app is a static site with no backend, so there's
   nowhere safe to hold a shared API key — anyone could open
   devtools and steal it. Instead, the person pastes their own
   Anthropic key, which is stored only in this browser's
   localStorage and sent only to api.anthropic.com.

   Two features share one Claude call shape:
   - Natural language quick-add (parses a free-text sentence
     into name/amount/category/date)
   - Category auto-suggest (guesses a category from the name
     the person is already typing)
   --------------------------------------------------------- */
const AI_MODEL = "claude-sonnet-4-6";
const AI_KEY_STORAGE = "tracker_anthropic_key";

function getAiKey() {
  return localStorage.getItem(AI_KEY_STORAGE) || "";
}

function initAiSettings() {
  const input = qs("aiKeyInput");
  const status = qs("aiKeyStatus");
  const clearBtn = qs("clearAiKeyBtn");

  function refreshKeyStatus() {
    const key = getAiKey();
    if (key) {
      status.textContent = `✅ Key saved (ends in …${key.slice(-4)})`;
      status.className = "ai-key-status saved";
      clearBtn.classList.remove("hidden");
      input.value = "";
      input.placeholder = "sk-ant-••••••••••••••••";
    } else {
      status.textContent = "No key saved yet — AI features are off.";
      status.className = "ai-key-status empty";
      clearBtn.classList.add("hidden");
      input.placeholder = "sk-ant-...";
    }
    refreshAiAvailabilityUI();
  }

  qs("saveAiKeyBtn").addEventListener("click", () => {
    const value = input.value.trim();
    if (!value.startsWith("sk-ant-")) {
      showToast("⚠️ That doesn't look like an Anthropic key (starts with sk-ant-)", { danger: true });
      return;
    }
    localStorage.setItem(AI_KEY_STORAGE, value);
    refreshKeyStatus();
    showToast("✅ AI key saved — try the quick-add box on Add Expense");
  });

  clearBtn.addEventListener("click", () => {
    localStorage.removeItem(AI_KEY_STORAGE);
    refreshKeyStatus();
    showToast("🗑️ AI key removed");
  });

  qs("goToAiSettingsLink").addEventListener("click", () => goToPage("goals"));

  refreshKeyStatus();
}

// Shows/hides the "add a key to unlock this" hint on the Add Expense page
function refreshAiAvailabilityUI() {
  const hasKey = !!getAiKey();
  qs("aiParseInput").disabled = !hasKey;
  qs("aiParseBtn").disabled = !hasKey;
  qs("aiParseNoKey").classList.toggle("hidden", hasKey);
}

/**
 * Calls Claude with a system prompt that forces strict JSON output.
 * Returns the parsed object, or throws with a friendly message.
 */
async function callClaudeForJson(systemPrompt, userText) {
  const key = getAiKey();
  if (!key) throw new Error("No API key saved yet.");

  let response;
  try {
    response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true"
      },
      body: JSON.stringify({
        model: AI_MODEL,
        max_tokens: 300,
        system: systemPrompt,
        messages: [{ role: "user", content: userText }]
      })
    });
  } catch (err) {
    throw new Error("Couldn't reach Claude — check your connection.");
  }

  if (response.status === 401) throw new Error("That API key was rejected. Double-check it on the Goals page.");
  if (response.status === 429) throw new Error("Rate limited — wait a moment and try again.");
  if (!response.ok) throw new Error(`Claude API error (${response.status}).`);

  const data = await response.json();
  const text = (data.content || [])
    .map(block => block.text || "")
    .join("")
    .trim();

  const cleaned = text.replace(/^```json\s*|^```\s*|```$/g, "").trim();

  try {
    return JSON.parse(cleaned);
  } catch (err) {
    throw new Error("Claude's response wasn't valid JSON — try rephrasing.");
  }
}

/* ---- natural language quick-add ---- */
function initAiParse() {
  qs("aiParseBtn").addEventListener("click", runAiParse);
  qs("aiParseInput").addEventListener("keydown", e => {
    if (e.key === "Enter") {
      e.preventDefault();
      runAiParse();
    }
  });
}

async function runAiParse() {
  const text = qs("aiParseInput").value.trim();
  const statusEl = qs("aiParseStatus");

  if (!text) {
    showToast("⚠️ Describe the expense first", { danger: true });
    return;
  }
  if (!getAiKey()) {
    showToast("⚠️ Add an Anthropic API key on the Goals page first", { danger: true });
    return;
  }

  statusEl.textContent = "✨ Reading that…";
  statusEl.className = "ai-parse-status busy";
  qs("aiParseBtn").disabled = true;

  const todayStr = new Date().toISOString().slice(0, 10);
  const systemPrompt =
    `You convert a short, casual sentence about a single personal expense into strict JSON. ` +
    `Today's date is ${todayStr}. ` +
    `Respond with ONLY a JSON object, no prose, no markdown fences, matching exactly this shape: ` +
    `{"name": string, "amount": number, "category": one of ["Food","Travel","Shopping","Bills","Other"], "daysAgo": integer}. ` +
    `"name" should be a short 1-4 word label for the expense (e.g. "Momos", "Cab to airport"). ` +
    `"amount" is a plain number, no currency symbol. ` +
    `"daysAgo" is how many days before today the expense happened (0 = today, 1 = yesterday, etc) based on words like "today"/"yesterday"/"last monday" — default to 0 if unclear. ` +
    `If the sentence doesn't contain enough information for a real expense, respond with {"error": "explanation"} instead.`;

  try {
    const result = await callClaudeForJson(systemPrompt, text);

    if (result.error) {
      statusEl.textContent = `⚠️ ${result.error}`;
      statusEl.className = "ai-parse-status error";
      return;
    }

    const amount = Number(result.amount);
    const category = CATEGORIES.includes(result.category) ? result.category : "Other";
    const daysAgo = Number.isFinite(Number(result.daysAgo)) ? Number(result.daysAgo) : 0;

    if (!result.name || !Number.isFinite(amount) || amount <= 0) {
      statusEl.textContent = "⚠️ Couldn't pull out a clear name and amount — try rephrasing.";
      statusEl.className = "ai-parse-status error";
      return;
    }

    const targetDate = new Date();
    targetDate.setDate(targetDate.getDate() - Math.max(0, daysAgo));

    qs("expenseName").value = result.name;
    qs("expenseAmount").value = amount;
    qs("expenseCategory").value = category;
    qs("expenseForm").dataset.aiDate = targetDate.toISOString(); // picked up by saveExpenseFromForm

    statusEl.textContent = "✅ Filled in below — check it over, then save.";
    statusEl.className = "ai-parse-status success";
    qs("aiParseInput").value = "";
    qs("expenseName").focus();
  } catch (err) {
    statusEl.textContent = `⚠️ ${err.message}`;
    statusEl.className = "ai-parse-status error";
  } finally {
    qs("aiParseBtn").disabled = false;
  }
}

/* ---- category auto-suggest while typing a name ---- */
function initAiCategorySuggest() {
  const nameInput = qs("expenseName");
  let debounceTimer = null;

  nameInput.addEventListener("input", () => {
    clearTimeout(debounceTimer);
    qs("aiSuggestStatus").classList.add("hidden");

    if (!getAiKey() || nameInput.value.trim().length < 3) return;

    debounceTimer = setTimeout(() => runAiCategorySuggest(nameInput.value.trim()), 700);
  });
}

async function runAiCategorySuggest(name) {
  // don't bother suggesting if the user already manually changed the
  // category for this same form session after the last suggestion
  const statusEl = qs("aiSuggestStatus");
  statusEl.textContent = "✨ thinking…";
  statusEl.className = "ai-suggest-status busy";
  statusEl.classList.remove("hidden");

  const systemPrompt =
    `Classify a short expense name into exactly one category. ` +
    `Respond with ONLY JSON: {"category": one of ["Food","Travel","Shopping","Bills","Other"]}. No other text.`;

  try {
    const result = await callClaudeForJson(systemPrompt, name);
    if (result.category && CATEGORIES.includes(result.category)) {
      qs("expenseCategory").value = result.category;
      statusEl.textContent = `✨ guessed ${result.category}`;
      statusEl.className = "ai-suggest-status";
    } else {
      statusEl.classList.add("hidden");
    }
  } catch (err) {
    // fail silently here — auto-suggest is a nice-to-have, not core flow
    statusEl.classList.add("hidden");
  }
}

/* ---------------------------------------------------------
   13. EXPORT (CSV + PDF)
   --------------------------------------------------------- */
function initExport() {
  qs("exportCsvBtn").addEventListener("click", exportCsv);
  qs("exportPdfBtn").addEventListener("click", exportPdf);
}

function csvEscape(value) {
  // wrap in quotes and escape inner quotes so commas/quotes in
  // expense names don't break the CSV structure
  const str = String(value).replace(/"/g, '""');
  return `"${str}"`;
}

function exportCsv() {
  if (expenses.length === 0) {
    showToast("⚠️ No expenses to export yet", { danger: true });
    return;
  }

  const header = ["Name", "Amount", "Category", "Date"].map(csvEscape).join(",");
  const rows = expenses.map(e =>
    [e.name, e.amount, e.category, new Date(e.date).toLocaleDateString("en-IN")]
      .map(csvEscape)
      .join(",")
  );

  const csv = [header, ...rows].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  downloadBlob(blob, "expenses.csv");
  showToast("📤 CSV exported");
}

function exportPdf() {
  if (expenses.length === 0) {
    showToast("⚠️ No expenses to export yet", { danger: true });
    return;
  }

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();

  doc.setFontSize(18);
  doc.text("Hanami — Expense Report", 14, 18);

  doc.setFontSize(11);
  doc.text(`Generated ${new Date().toLocaleDateString("en-IN")}`, 14, 26);

  const total = expenses.reduce((s, e) => s + e.amount, 0);
  doc.text(`Total spent: Rs. ${total.toLocaleString("en-IN")}  |  Goal: Rs. ${goal.toLocaleString("en-IN")}`, 14, 33);

  let y = 46;
  doc.setFontSize(12);
  doc.text("Name", 14, y);
  doc.text("Amount", 90, y);
  doc.text("Category", 130, y);
  doc.text("Date", 170, y);
  y += 4;
  doc.setLineWidth(0.3);
  doc.line(14, y, 196, y);
  y += 6;

  doc.setFontSize(10);
  expenses.forEach(e => {
    if (y > 280) { // start a new page if we run out of room
      doc.addPage();
      y = 20;
    }
    doc.text(String(e.name).slice(0, 28), 14, y);
    doc.text(`Rs. ${e.amount.toLocaleString("en-IN")}`, 90, y);
    doc.text(e.category, 130, y);
    doc.text(new Date(e.date).toLocaleDateString("en-IN"), 170, y);
    y += 7;
  });

  doc.save("expenses.pdf");
  showToast("📄 PDF exported");
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/* ---------------------------------------------------------
   14. BACKUP & RESTORE (JSON)
   Everything lives in localStorage only, so a cleared cache
   or new device wipes history. This lets the person download
   a full snapshot and load it back in (here or elsewhere).
   --------------------------------------------------------- */
function initBackupRestore() {
  qs("backupBtn").addEventListener("click", downloadBackup);

  qs("restoreBtn").addEventListener("click", () => {
    qs("restoreFileInput").click();
  });

  qs("restoreFileInput").addEventListener("change", e => {
    const file = e.target.files[0];
    if (file) restoreFromFile(file);
    e.target.value = ""; // allow re-selecting the same file later
  });
}

function downloadBackup() {
  const snapshot = {
    version: 1,
    exportedAt: new Date().toISOString(),
    expenses,
    goal,
    recurringItems,
    categoryBudgets
  };

  const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: "application/json" });
  const stamp = new Date().toISOString().slice(0, 10);
  downloadBlob(blob, `hanami-backup-${stamp}.json`);
  showToast("💾 Backup downloaded");
}

function restoreFromFile(file) {
  const reader = new FileReader();

  reader.onload = () => {
    let data;
    try {
      data = JSON.parse(reader.result);
    } catch (err) {
      showToast("⚠️ That file isn't valid backup JSON", { danger: true });
      return;
    }

    if (!data || !Array.isArray(data.expenses)) {
      showToast("⚠️ This doesn't look like a Hanami backup", { danger: true });
      return;
    }

    const count = data.expenses.length;
    const confirmed = window.confirm(
      `Restore ${count} expense${count === 1 ? "" : "s"} from this backup? ` +
      `This will replace everything currently saved in this browser.`
    );
    if (!confirmed) return;

    expenses = data.expenses;
    goal = Number.isFinite(Number(data.goal)) && data.goal > 0 ? Number(data.goal) : goal;
    recurringItems = Array.isArray(data.recurringItems) ? data.recurringItems : [];
    categoryBudgets = (data.categoryBudgets && typeof data.categoryBudgets === "object") ? data.categoryBudgets : {};

    selectedIds.clear();
    persist();
    render();
    showToast(`📂 Restored ${count} expense${count === 1 ? "" : "s"}`);
  };

  reader.onerror = () => {
    showToast("⚠️ Couldn't read that file", { danger: true });
  };

  reader.readAsText(file);
}

/* ---------------------------------------------------------
   15. TOAST NOTIFICATIONS (with optional undo action)
   --------------------------------------------------------- */
let toastTimer = null;

function showToast(message, opts = {}) {
  const { danger = false, undo = false } = opts;

  const toast = qs("toast");
  const undoBtn = qs("toastUndoBtn");

  qs("toastText").textContent = message;
  toast.classList.toggle("danger", danger);
  toast.classList.remove("hidden");
  undoBtn.classList.toggle("hidden", !undo);

  // retrigger the show animation even if a toast is already visible
  requestAnimationFrame(() => toast.classList.add("show"));

  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.classList.remove("show");
    pendingUndo = null; // undo window has closed
    setTimeout(() => toast.classList.add("hidden"), 250);
  }, undo ? 5000 : 2400); // give undo more time before it disappears
}

function initToastUndo() {
  qs("toastUndoBtn").addEventListener("click", () => {
    undoDelete();
    clearTimeout(toastTimer);
    qs("toast").classList.remove("show");
    setTimeout(() => qs("toast").classList.add("hidden"), 250);
  });
}

/* ---------------------------------------------------------
   16. INIT
   --------------------------------------------------------- */
function init() {
  loadState();
  processDueRecurringExpenses();

  initTheme();
  initNavigation();
  initPetals();
  initRangeFilter();
  initRecurringForm();
  initExpenseForm();
  initGoalForm();
  initExport();
  initToastUndo();
  initBulkActions();
  initBackupRestore();
  initAiSettings();
  initAiParse();
  initAiCategorySuggest();

  qs("search").addEventListener("input", render);

  render();
}

document.addEventListener("DOMContentLoaded", init);
