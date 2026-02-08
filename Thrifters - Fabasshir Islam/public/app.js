// -------------------CONFIG---------------
const STUDENT_ID = "M01043814";
const BASE_URL = `/${STUDENT_ID}`;

let currentUser = { loggedIn: false, userId: null, username: null };
let feedCache = [];
let weatherLoaded = false;
let userHasFollows = false; // updated after loading the feed


function $(id) { return document.getElementById(id); }

/* ---------- Mini helpers ---------- */
async function apiGet(path) {
    const r = await fetch(`${BASE_URL}${path}`, { credentials: "same-origin" });
    return r.json();
}
async function apiPost(path, data) {
    const r = await fetch(`${BASE_URL}${path}`, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
    return r.json();
}
async function apiDelete(path, data) {
    const opt = { method: "DELETE", credentials: "same-origin", headers: {} }; if (data) { opt.headers["Content-Type"] = "application/json"; opt.body = JSON.stringify(data); } const r = await fetch(`${BASE_URL}${path}`, opt); return r.json();
}

async function performSearch(q) {
    const feedBox = $("feed-items");
    const hint = $("empty-feed-hint");
    if (!q) {
        await loadFeed();
        return;
    }
    const r = await apiGet(`/contents?q=${encodeURIComponent(q)}`);
    if (r.success) {
        renderItemsGrid("feed-items", r.items);
        if (hint) hint.innerHTML = "";
    } else {
        if (feedBox) feedBox.innerHTML = `<p class="text-danger">Search failed.</p>`;
    }
}


/* ---------- Messages ---------- */
let msgTimer = null;
function hideMessage() { const box = $("message-box"); if (!box) return; box.className = "alert d-none"; box.textContent = ""; if (msgTimer) { clearTimeout(msgTimer); msgTimer = null; } }
function showMessage(type, text, ms = 2000) {
    const box = $("message-box"); if (!box) return;
    box.textContent = text || ""; box.className = "alert";
    box.classList.add(type === "error" ? "alert-danger" : type === "success" ? "alert-success" : "alert-info");
    box.classList.remove("d-none");
    if (msgTimer) clearTimeout(msgTimer);
    if (ms > 0) msgTimer = setTimeout(hideMessage, ms);
}

/* ---------- Landing carousel ---------- */
function setupHeroCarousel() {
    const slides = document.querySelectorAll(".hero-slide"); if (!slides.length) return;
    let i = 0; slides[0].classList.add("active");
    setInterval(() => { slides[i].classList.remove("active"); i = (i + 1) % slides.length; slides[i].classList.add("active"); }, 4000);
}

/* ---------- Auth ---------- */
function clearAuthForms() { $("login-form")?.reset(); $("register-form")?.reset(); hideMessage(); }
function setupAuthToggle() {
    $("show-register-link")?.addEventListener("click", (e) => { e.preventDefault(); hideMessage(); $("login-form").classList.add("d-none"); $("register-form").classList.remove("d-none"); });
    $("show-login-link")?.addEventListener("click", (e) => { e.preventDefault(); hideMessage(); $("register-form").classList.add("d-none"); $("login-form").classList.remove("d-none"); });
}
function enterApp() {
    $("landing-wrapper")?.classList.add("d-none");
    $("app-main")?.classList.remove("d-none");
    setActiveAppSection("feed-section");
    loadFeed();
    loadProfile();
    loadSuggestionsSidebar();
    if (!weatherLoaded) autoWeatherInit(); // auto geolocate once
}
function exitApp() {
    $("app-main")?.classList.add("d-none");
    $("landing-wrapper")?.classList.remove("d-none");
    clearAuthForms();
}
function setupLoginForm() {
    $("login-form")?.addEventListener("submit", async (e) => {
        e.preventDefault(); hideMessage();
        const username = $("login-username").value.trim();
        const password = $("login-password").value;
        if (!username || !password) return showMessage("error", "Enter username and password.");
        try {
            const r = await apiPost("/login", { username, password });
            if (!r.success) return showMessage("error", r.message || "Login failed", 3000);
            const st = await apiGet("/login");
            currentUser = { loggedIn: !!st.loggedIn, userId: st.userId || null, username: r.username || username };
            showMessage("success", "Login successful.");
            setTimeout(enterApp, 250);
        } catch { showMessage("error", "Server error"); }
    });
}
function setupRegisterForm() {
    $("register-form")?.addEventListener("submit", async (e) => {
        e.preventDefault(); hideMessage();
        const username = $("reg-username").value.trim();
        const email = $("reg-email").value.trim();
        const password = $("reg-password").value;
        if (!username || !email || !password) return showMessage("error", "Fill all fields.");
        try {
            const r = await apiPost("/users", { username, email, password });
            if (!r.success) return showMessage("error", r.message || "Registration failed", 3000);
            currentUser = { loggedIn: true, userId: r.userId, username: r.username || username };
            showMessage("success", "Account created.");
            setTimeout(enterApp, 250);
        } catch { showMessage("error", "Server error"); }
    });
}
function setupLogout() {
    $("logout-btn")?.addEventListener("click", async (e) => {
        e.preventDefault();
        try { await apiDelete("/login"); } catch { }
        currentUser = { loggedIn: false, userId: null, username: null };
        exitApp();
    });
}

/* ---------- Header ---------- */
function setupHeaderProfileButton() {
    $("header-profile-btn")?.addEventListener("click", (e) => {
        e.preventDefault();
        if (!currentUser.loggedIn) return showMessage("error", "Please log in first.");
        setActiveAppSection("profile-section");
        loadProfile();
    });
}
function setupHeaderSearch() {
    const run = () => performSearch($("header-search-input").value.trim());
    $("header-search-btn")?.addEventListener("click", (e) => { e.preventDefault(); run(); });
    $("header-search-form")?.addEventListener("submit", (e) => { e.preventDefault(); run(); });
}

/* ---------- App nav ---------- */
function setActiveAppSection(id) {
    document.querySelectorAll(".app-section").forEach(sec => {
        if (sec.id === id) { sec.classList.add("active"); sec.classList.remove("d-none"); }
        else { sec.classList.remove("active"); sec.classList.add("d-none"); }
    });
    document.querySelectorAll(".app-nav-link").forEach(btn => btn.classList.toggle("active", btn.getAttribute("data-section") === id));
}
function setupAppNav() {
    $("app-nav")?.addEventListener("click", async (e) => {
        const btn = e.target.closest("button[data-section]"); if (!btn) return;
        const sec = btn.getAttribute("data-section");
        if (sec === "post-section") { openPostModal(); return; }
        setActiveAppSection(sec);
        if (sec === "feed-section") await loadFeed();
        if (sec === "favorites-section") await loadFavourites();
        if (sec === "purchased-items-section") await loadPurchased();
        if (sec === "profile-section") await loadProfile();
    });
}

/* ---------- Cards (Buy + Fav) ---------- */
function heartButton(item) {
    const btn = document.createElement("button");
    btn.className = "heart item-card-btn" + (item.isFaved ? " faved" : "");
    btn.title = item.isFaved ? "Unfavorite" : "Favorite";
    btn.textContent = item.isFaved ? "♥" : "♡";
    if (String(item.ownerId) === String(currentUser.userId)) btn.disabled = true;
    btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        try {
            if (!item.isFaved) {
                const r = await apiPost("/favorites", { itemId: item._id });
                if (r.success) { item.isFaved = true; btn.textContent = "♥"; btn.classList.add("faved"); }
            } else {
                const r = await apiDelete(`/favorites/${item._id}`);
                if (r.success) { item.isFaved = false; btn.textContent = "♡"; btn.classList.remove("faved"); }
            }
        } catch { }
    });
    return btn;
}

function createItemCard(item) {
    const isOwner = String(item.ownerId) === String(currentUser.userId);
    const isSold = item.status === "sold out" || !!item.purchasedBy;

    const card = document.createElement("div");
    card.className = "item-card";

    const imgWrap = document.createElement("div");
    imgWrap.className = "item-card-img-wrap";

    // SOLD badge
    if (isSold) {
        const sold = document.createElement("div");
        sold.className = "item-card-sold";
        sold.textContent = "SOLD";
        imgWrap.appendChild(sold);
    }

    const img = document.createElement("img");
    img.className = "item-card-img";
    img.src = item.image || NO_IMG;
    img.alt = item.title || "item";
    imgWrap.appendChild(img);

    const body = document.createElement("div");
    body.className = "item-card-body";

    const title = document.createElement("h6");
    title.className = "item-card-title";
    title.textContent = item.title || "Item";

    const meta = document.createElement("p");
    meta.className = "item-card-meta";
    const priceText = item.priceType === "sale" ? `£${item.price || 0}` : "Free";
    const condition = item.condition || "used";
    const kind = item.itemKind || "item";
    meta.textContent = `${priceText} • ${kind} • ${condition}`;

    const desc = document.createElement("p");
    desc.className = "item-card-desc";
    desc.textContent = (item.description || "") + (item.ownerUsername ? ` (by ${item.ownerUsername}${item.ownerLocation ? " • " + item.ownerLocation : ""})` : "");

    const footer = document.createElement("div");
    footer.className = "item-card-footer";

    // Left: favourite heart (disabled for your own item)
    footer.appendChild(heartButton(item));

    // Right: either BUY (if available & not owner) or BUYER INFO (if sold & owner) or nothing
    if (!isOwner && !isSold) {
        const buyBtn = document.createElement("button");
        buyBtn.className = "btn btn-outline-primary btn-sm item-card-btn";
        buyBtn.textContent = "Buy";
        buyBtn.addEventListener("click", (e) => { e.stopPropagation(); openBuyModal(item); });
        footer.appendChild(buyBtn);
    } else if (isOwner && isSold && item.purchaseDetails) {
        const buyerBtn = document.createElement("button");
        buyerBtn.className = "btn btn-outline-secondary btn-sm item-card-btn";
        buyerBtn.textContent = "Buyer info";
        buyerBtn.addEventListener("click", (e) => { e.stopPropagation(); openBuyerInfoModal(item); });
        footer.appendChild(buyerBtn);
    }

    body.appendChild(title);
    body.appendChild(meta);
    body.appendChild(desc);
    body.appendChild(footer);

    card.appendChild(imgWrap);
    card.appendChild(body);
    return card;
}


function renderItemsGrid(containerId, items) {
    const box = document.getElementById(containerId);
    if (!box) return;

    // Make the container itself the grid
    box.classList.add("card-grid");

    // Reset content
    box.innerHTML = "";

    if (!items || !items.length) {
        box.classList.remove("card-grid");
        box.innerHTML = `<p class="text-muted">No items found.</p>`;
        return;
    }

    // Append cards directly into the grid container
    items.forEach(it => box.appendChild(createItemCard(it)));
}


/* ---------- Purchase modal ---------- */
function openBuyModal(item) {
    const modal = $("purchase-modal"); const form = $("purchase-form");
    if (!modal || !form) return;
    form.reset();
    modal.classList.remove("d-none");
    requestAnimationFrame(() => modal.classList.add("show"));

    $("purchase-close")?.addEventListener("click", () => closePurchaseModal(), { once: true });
    modal.querySelector(".app-modal-backdrop")?.addEventListener("click", closePurchaseModal, { once: true });

    form.onsubmit = async (e) => {
        e.preventDefault();
        const address = $("address").value.trim();
        const cardNumber = $("card-number").value.trim();
        if (!address || !cardNumber) { showMessage("Please provide both address and card number."); return; }
        try {
            const r = await apiPost(`/contents/${item._id}/purchase`, { address, cardNumber });
            if (r.success) {
                showMessage("Purchase successful!");
                closePurchaseModal();
                await loadFeed();
                await loadPurchased();
            } else {
                showMessage(r.message || "Failed to purchase");
            }
        } catch { console.error("Error during purchase"); }
    };
}
function closePurchaseModal() {
    const modal = $("purchase-modal");
    if (!modal) return;
    modal.classList.remove("show");
    setTimeout(() => modal.classList.add("d-none"), 220);
}

function openBuyerInfoModal(item) {
    const modal = $("buyer-info-modal");
    const body = $("buyer-info-body");
    if (!modal || !body) return;

    const pd = item.purchaseDetails || {};
    const address = pd.address || "(no address available)";
    const last4 = pd.last4 ? "•••• •••• •••• " + pd.last4 : "(no card info)";
    const when = pd.purchasedAt ? new Date(pd.purchasedAt).toLocaleString() : "";

    body.innerHTML = `
    <div class="mb-2"><strong>Purchased:</strong> ${when}</div>
    <div class="mb-2"><strong>Buyer Address:</strong><br><pre style="white-space:pre-wrap;margin:0">${address}</pre></div>
    <div class="mb-1"><strong>Card:</strong> ${last4}</div>
    <div class="text-muted small">Shown only to the seller & buyer.</div>
  `;

    modal.classList.remove("d-none");
    requestAnimationFrame(() => modal.classList.add("show"));

    $("buyer-info-close")?.addEventListener("click", closeBuyerInfoModal, { once: true });
    modal.querySelector(".app-modal-backdrop")?.addEventListener("click", closeBuyerInfoModal, { once: true });
}
function closeBuyerInfoModal() {
    const modal = $("buyer-info-modal");
    if (!modal) return;
    modal.classList.remove("show");
    setTimeout(() => modal.classList.add("d-none"), 220);
}


/* ---------- Post modal ---------- */
function resetPostForm() {
    $("post-item-form")?.reset();
    $("item-category").value = "clothing";
    $("item-condition").value = "used";
    $("item-priceType").value = "free";
    $("item-kind").value = "top";
}
function openPostModal() {
    resetPostForm();
    const m = $("post-modal");
    m.classList.remove("d-none");
    requestAnimationFrame(() => m.classList.add("show"));
}
function closePostModal() {
    const m = $("post-modal");
    m.classList.remove("show");
    setTimeout(() => m.classList.add("d-none"), 220);
}
function setupPostModal() {
    $("post-modal-close")?.addEventListener("click", (e) => { e.preventDefault(); closePostModal(); });
    $("post-modal-cancel")?.addEventListener("click", (e) => { e.preventDefault(); closePostModal(); });
    document.querySelector("#post-modal .app-modal-backdrop")?.addEventListener("click", closePostModal);
}
function setupPostItemForm() {
    $("post-item-form")?.addEventListener("submit", async (e) => {
        e.preventDefault();
        if (!currentUser.loggedIn) return showMessage("error", "Login first.");
        const title = $("item-title").value.trim();
        const description = $("item-description").value.trim();
        const category = $("item-category").value;
        const condition = $("item-condition").value;
        const priceType = $("item-priceType").value;
        const price = $("item-price").value;
        const itemKind = $("item-kind").value;
        const imageInput = $("item-image");
        if (!title || !description) return showMessage("error", "Title & description required.");

        try {
            let imagePath = "";
            if (imageInput.files && imageInput.files[0]) {
                const fd = new FormData(); fd.append("image", imageInput.files[0]);
                const up = await (await fetch(`${BASE_URL}/upload/item`, { method: "POST", body: fd })).json();
                if (!up.success) return showMessage("error", up.message || "Upload failed.");
                imagePath = up.imagePath;
            }
            const r = await apiPost("/contents", { title, description, category, condition, priceType, price, image: imagePath, itemKind });
            if (!r.success) return showMessage("error", r.message || "Post failed.");
            showMessage("success", "Item posted.");
            closePostModal();
            await loadFeed();
            await loadProfile();
        } catch { showMessage("error", "Server error."); }
    });
}

/* ---------- Profile ---------- */
async function loadProfile() {
    if (!currentUser.loggedIn) return;
    const me = await apiGet("/me");
    if (me.success) {
        const u = me.user || {}; const info = $("profile-info");
        const joined = u.createdAt ? new Date(u.createdAt).toLocaleDateString() : "—";
        info.innerHTML = `
      <div class="d-flex align-items-center gap-2 mb-2">
        <div class="profile-avatar">${(u.username || "?").charAt(0).toUpperCase()}</div>
        <div>
          <div class="fw-bold">${u.username || ""}</div>
          <div class="text-muted small">Joined ${joined}</div>
        </div>
      </div>
      <div class="d-flex gap-3 small">
        <div><strong>${me.stats?.itemsCount ?? 0}</strong> items</div>
        <div><strong>${me.stats?.followingCount ?? 0}</strong> following</div>
        <div><strong>${me.stats?.followersCount ?? 0}</strong> followers</div>
      </div>`;
    }
    const all = await apiGet("/contents?includeSold=true");
    if (all.success) {
        const mine = (all.items || []).filter(i => String(i.ownerId) === String(currentUser.userId));
        renderItemsGrid("profile-items", mine);
    }
}
function setupProfilePostButton() { $("profile-post-btn")?.addEventListener("click", openPostModal); }

/* ---------- Feed ---------- */
async function loadFeed() {
    if (!currentUser.loggedIn) return;
    const feedBox = $("feed-items");
    const hint = $("empty-feed-hint");
    feedBox.innerHTML = ""; hint.innerHTML = "";

    const data = await apiGet("/feed");
    if (!data.success) { feedBox.innerHTML = `<p class="text-danger">Failed to load feed.</p>`; return; }

    if (data.meta && data.meta.followed === false) {
        userHasFollows = false;
        hint.innerHTML = `<p class="text-muted">Follow some sellers (right sidebar) to see items in your feed.</p>`;
        feedCache = [];
        feedBox.innerHTML = "";
        await loadSuggestionsSidebar();
        return;
    }

    userHasFollows = true; // user follows at least one seller
    feedCache = data.feed || [];
    renderItemsGrid("feed-items", feedCache);
}


/* ---------- Right Sidebar: Suggested sellers ---------- */
async function loadSuggestionsSidebar(query = "") {
    const box = $("suggested-sellers-list");
    if (!box) return;

    box.innerHTML = `<p class="text-muted small">Loading…</p>`;

    const url = query
        ? `/sellers/suggestions?q=${encodeURIComponent(query)}`
        : `/sellers/suggestions`;

    const data = await apiGet(url);
    box.innerHTML = "";

    if (!data.success) {
        box.innerHTML = `<p class="text-danger small">Failed to load sellers</p>`;
        return;
    }

    const sellers = data.sellers || [];
    if (!sellers.length) {
        box.innerHTML = `<p class="text-muted small">${query ? "No sellers match your search." : "No suggestions right now."
            }</p>`;
        return;
    }

    sellers.forEach(s => {
        const row = document.createElement("div");
        row.className = "seller-item";

        row.innerHTML = `
      <div class="seller-avatar">${(s.username || "?").charAt(0).toUpperCase()}</div>
      <div style="flex:1;">
        <div class="seller-name">@${s.username}</div>
        <div class="seller-meta">${s.itemsCount || 0} items ${s.location ? "• " + s.location : ""}</div>
      </div>
      <button class="btn btn-outline-primary btn-sm">${s.isFollowed ? "Following" : "Follow"}</button>
    `;

        const btn = row.querySelector("button");
        btn.disabled = !!s.isFollowed;
        btn.onclick = async () => {
            const r = await apiPost("/follow", { targetUserId: s.userId });
            if (r.success) {
                // Reload the same view (search or suggestions)
                await loadSuggestionsSidebar(query);
                await loadFeed();
            } else {
                showMessage(r.message || "Could not follow");
            }
        };

        box.appendChild(row);
    });
}

function setupSellerSearch() {
    const form = $("seller-search-form");
    if (!form) return;

    const input = $("seller-search-input");
    const clear = $("seller-search-clear");

    const run = () => {
        const q = (input.value || "").trim();
        loadSuggestionsSidebar(q);   // default suggestions
    };

    form.addEventListener("submit", (e) => { e.preventDefault(); run(); });
    $("seller-search-btn")?.addEventListener("click", (e) => { e.preventDefault(); run(); });

    clear?.addEventListener("click", () => {
        input.value = "";
        loadSuggestionsSidebar("");  // back to suggestions
    });
}



/* ---------- Filters ---------- */
function setupFeedFilters() {
    $("feed-filter-form")?.addEventListener("submit", (e) => {
        e.preventDefault();
        const title = $("feed-filter-title").value.trim().toLowerCase();
        const min = parseFloat($("feed-filter-min-price").value);
        const max = parseFloat($("feed-filter-max-price").value);
        let items = feedCache.slice();
        if (title) items = items.filter(i => (i.title || "").toLowerCase().includes(title));
        if (!isNaN(min)) items = items.filter(i => (i.priceType === "sale" ? (i.price || 0) : 0) >= min);
        if (!isNaN(max)) items = items.filter(i => (i.priceType === "sale" ? (i.price || 0) : 0) <= max);
        renderItemsGrid("feed-items", items);
    });
    $("feed-filter-clear")?.addEventListener("click", () => {
        $("feed-filter-title").value = ""; $("feed-filter-min-price").value = ""; $("feed-filter-max-price").value = "";
        renderItemsGrid("feed-items", feedCache);
    });
}

/* ---------- Favourites & Purchased ---------- */
async function loadFavourites() { const r = await apiGet("/favorites"); if (r.success) renderItemsGrid("favorites-grid", r.items); }
async function loadPurchased() { const r = await apiGet("/purchased"); if (r.success) renderItemsGrid("purchased-items", r.items); }

/* ---------- Weather (auto geolocation + animation) ---------- */
function renderWeatherAnimation(container, mode) {
    container.innerHTML = "";
    // modes: sunny, cloudy, rainy, cold
    if (mode === "sunny") {
        const sun = document.createElement("div"); sun.className = "sun";
        for (let i = 0; i < 12; i++) { const ray = document.createElement("div"); ray.className = "ray"; ray.style.transform = `rotate(${i * 30}deg)`; sun.appendChild(ray); }
        container.appendChild(sun);
    } else if (mode === "cloudy") {
        const cloud = document.createElement("div"); cloud.className = "cloud"; container.appendChild(cloud);
    } else if (mode === "rainy") {
        const cloud = document.createElement("div"); cloud.className = "cloud"; container.appendChild(cloud);
        for (let i = 0; i < 18; i++) { const drop = document.createElement("div"); drop.className = "drop"; drop.style.left = (20 + i * 8) % 260 + "px"; drop.style.animationDelay = (i * 0.07) + "s"; container.appendChild(drop); }
    } else if (mode === "cold") {
        const sun = document.createElement("div"); sun.className = "sun"; sun.style.background = "#FFC149"; container.appendChild(sun);
        const cloud = document.createElement("div"); cloud.className = "cloud"; cloud.style.left = "80px"; container.appendChild(cloud);
    }
}

async function showWeather(lat, lon, label = "Your location") {
    const text = $("weather-out");
    const cityLbl = $("weather-city-label");
    const anim = $("weather-anim");
    const chips = $("weather-suggest");

    if (cityLbl) cityLbl.textContent = label;
    if (text) text.textContent = "Loading weather…";
    if (chips) chips.innerHTML = "";

    try {
        const r = await apiGet(`/weather?lat=${lat}&lon=${lon}`);
        if (!r.success) { if (text) text.textContent = "Could not load weather."; return; }

        const avgMax = r.meta?.avgMax != null ? r.meta.avgMax.toFixed(1) : "–";
        const rain = Math.round(r.meta?.totalRain || 0);

        if (text) {
            text.innerHTML =
                `<div><strong>Avg max:</strong> ${avgMax}°C • <strong>Rain:</strong> ${rain} mm</div>
         <div class="text-muted">${r.suggestion}</div>
         <div class="text-muted small mt-1">Tip: tap a keyword to search.</div>`;
        }

        // Animated scene
        let mode = "sunny";
        if (r.meta?.avgMax < 8) mode = "cold";
        if (r.meta?.totalRain > 30) mode = "rainy";
        else if (r.meta?.avgMax < 15) mode = "cloudy";
        renderWeatherAnimation(anim, mode);

        // Render keyword chips
        const kws = Array.from(new Set((r.meta?.keywords || []).map(k => String(k).trim()).filter(Boolean))).slice(0, 10);
        if (chips && kws.length) {
            chips.insertAdjacentHTML("beforeend", `<div class="text-muted small" style="flex:1 0 100%;">Try:</div>`);
            // inside showWeather() when rendering chips
            kws.forEach(k => {
                const b = document.createElement("button");
                b.className = "suggest-pill";
                b.type = "button";
                b.textContent = k;
                b.onclick = () => {
                    if (!userHasFollows) {
                        showMessage("Follow at least one seller to see items from keyword searches. Use the Suggested Sellers panel on the right.");
                        // focus the sidebar to guide the user
                        const list = $("suggested-sellers-list");
                        if (list) list.scrollIntoView({ behavior: "smooth", block: "nearest" });
                        return;
                    }
                    $("header-search-input").value = k;
                    setActiveAppSection("feed-section");
                    performSearch(k);
                };
                chips.appendChild(b);
            });

        }

    } catch {
        if (text) text.textContent = "Error loading weather.";
    }
}


function autoWeatherInit() {
    const text = $("weather-out");
    if (!navigator.geolocation) {
        weatherLoaded = true;
        showWeather(51.5074, -0.1278, "London (fallback)");
        return;
    }
    navigator.geolocation.getCurrentPosition(
        pos => {
            weatherLoaded = true;
            const { latitude, longitude } = pos.coords;
            showWeather(latitude, longitude, "Near you");
        },
        _err => {
            weatherLoaded = true;
            showWeather(51.5074, -0.1278, "London (fallback)");
            if (text) text.insertAdjacentHTML("beforeend", `<div class="text-muted small mt-1">Location permission denied. Using London.</div>`);
        },
        { enableHighAccuracy: true, timeout: 6000, maximumAge: 300000 }
    );
}

/* ---------- Init ---------- */
document.addEventListener("DOMContentLoaded", () => {
    setupHeroCarousel();
    setupAuthToggle();
    setupLoginForm();
    setupRegisterForm();
    setupLogout();
    setupHeaderProfileButton();
    setupHeaderSearch();

    setupAppNav();
    setupPostModal();
    setupPostItemForm();
    setupProfilePostButton();
    setupSellerSearch();

    setupFeedFilters();
});
