// ==UserScript==
// @name         JH Pet Alert Auto Feed
// @namespace    JH-MagicGarden
// @version      2.1.0
// @description  Arie's Mod 알림 임계값을 이용한 활성 펫 자동 급여
// @author       JunHwan, ChatGPT
// @match        https://magicgarden.gg/r/*
// @match        https://magiccircle.gg/r/*
// @match        https://starweaver.org/r/*
// @match        https://1227719606223765687.discordsays.com/*
// @run-at       document-start
// @inject-into  page
// @grant        none
// @connect      raw.githubusercontent.com
// @updateURL    https://raw.githubusercontent.com/JunHwan48/MGWeather_JH/main/JH_Weatherinfo.user.js
// @downloadURL  https://raw.githubusercontent.com/JunHwan48/MGWeather_JH/main/JH_Weatherinfo.user.js
// ==/UserScript==

(() => {
    "use strict";

    const CHECK_MS = 10000;
    const CONFIRM_MS = 15000;
    const MAX_PETS = 3;
    const MAX_LOGS = 20;

    const ARIES_KEY =
        "aries_mod";

    const ENABLE_KEY =
        "jh_pet_alert_auto_feed_enabled";

    const ID = {
        style: "jh-pet-style",
        ui: "jh-pet-ui",
        toggle: "jh-pet-toggle",
        message: "jh-pet-message",
        popup: "jh-pet-popup"
    };

    let activePets = [];
    let unsubscribe = null;
    let subscribing = false;
    let checking = false;
    let currentTab = "feed";

    const pendingFeeds = new Map();
    const warnings = new Map();
    const feedLogs = [];

    const text = value =>
        String(value ?? "").trim();

    const escapeHTML = value =>
        String(value ?? "")
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;")
            .replaceAll("'", "&#039;");

    const formatPercent = value => {
        const number =
            Number(value);

        return Number.isFinite(number)
            ? `${number.toFixed(1)}%`
            : "-";
    };

    const formatTime = value => {
        try {
            return new Date(value)
                .toLocaleTimeString(
                    "ko-KR",
                    {
                        hour: "2-digit",
                        minute: "2-digit",
                        second: "2-digit"
                    }
                );
        } catch {
            return "";
        }
    };

    function readAries() {
        try {
            return JSON.parse(
                localStorage.getItem(
                    ARIES_KEY
                ) || "{}"
            );
        } catch {
            return {};
        }
    }

    function isEnabled() {
        const saved =
            localStorage.getItem(
                ENABLE_KEY
            );

        return saved === null
            ? true
            : saved === "true";
    }

    function setEnabled(enabled) {
        localStorage.setItem(
            ENABLE_KEY,
            String(Boolean(enabled))
        );

        updateToggle();
    }

    function updateToggle() {
        const button =
            document.getElementById(
                ID.toggle
            );

        if (!button) {
            return;
        }

        const enabled =
            isEnabled();

        button.textContent =
            enabled
                ? "🍓 ON"
                : "🍓 OFF";

        button.classList.toggle(
            "enabled",
            enabled
        );
    }

    function enableInstantFeedWidget() {
        const settings =
            readAries();

        settings.pets ??= {};
        settings.pets.instantFeedWidget ??= {};

        if (
            settings.pets
                .instantFeedWidget
                .enabled === true
        ) {
            return;
        }

        settings.pets
            .instantFeedWidget
            .enabled = true;

        try {
            localStorage.setItem(
                ARIES_KEY,
                JSON.stringify(
                    settings
                )
            );
        } catch {
            setWarning(
                "settings",
                "Arie’s Mod",
                "Instant Feed 설정을 저장하지 못했습니다."
            );
        }
    }

    function getAlertRule(petId) {
        const alerts =
            readAries()
                ?.pets
                ?.alerts ?? {};

        const defaultThreshold =
            Math.max(
                1,
                Math.min(
                    100,
                    Math.round(
                        Number(
                            alerts
                                .defaultThresholdPct ??
                            25
                        )
                    )
                )
            );

        if (
            alerts.globalEnabled ===
            false
        ) {
            return {
                enabled: false,
                threshold:
                    defaultThreshold
            };
        }

        if (
            alerts.generalEnabled ===
            true
        ) {
            return {
                enabled: true,
                threshold:
                    defaultThreshold
            };
        }

        const petRule =
            alerts.pets?.[petId] ??
            {};

        return {
            enabled:
                petRule.enabled ===
                true,

            threshold:
                Math.max(
                    1,
                    Math.min(
                        100,
                        Math.round(
                            Number(
                                petRule
                                    .thresholdPct ??
                                defaultThreshold
                            )
                        )
                    )
                )
        };
    }

    function getService() {
        return (
            window.QWS_PetsService ??
            globalThis.QWS_PetsService ??
            null
        );
    }

    function getPetId(pet) {
        return text(
            pet?.slot?.id
        );
    }

    function getHunger(pet) {
        try {
            const value =
                Number(
                    getService()
                        ?.getHungerPctFor?.(
                            pet
                        )
                );

            return Number.isFinite(
                value
            )
                ? value
                : NaN;
        } catch {
            return NaN;
        }
    }

    function getFeedButtons() {
        return Array.from(
            document.querySelectorAll(
                '[data-instant-feed-btn="1"][data-pet-id]'
            )
        ).filter(button =>
            button.isConnected &&
            text(
                button.dataset.petId
            )
        );
    }

    function findFeedButton(petId) {
        return (
            getFeedButtons().find(
                button =>
                    text(
                        button.dataset
                            .petId
                    ) === petId
            ) ?? null
        );
    }

    function getPetName(
        petId,
        pet,
        index
    ) {
        const button =
            findFeedButton(
                petId
            );

        return (
            text(
                button
                    ?.querySelector(
                        '[data-instant-feed-name="1"]'
                    )
                    ?.textContent
            ) ||
            text(
                pet?.slot
                    ?.petSpecies ??
                pet?.petSpecies ??
                pet?.species
            ) ||
            `${index + 1}번 펫`
        );
    }

    function hideInstantFeedWidget() {
        const buttons =
            getFeedButtons();

        if (!buttons.length) {
            return;
        }

        let root =
            buttons[0]
                .parentElement;

        for (
            let depth = 0;
            depth < 10;
            depth++
        ) {
            if (!root) {
                return;
            }

            if (
                buttons.every(
                    button =>
                        root.contains(
                            button
                        )
                ) &&
                text(
                    root.textContent
                ).includes(
                    "Instant Feed"
                )
            ) {
                root.classList.add(
                    "jh-hide-feed-widget"
                );

                return;
            }

            root =
                root.parentElement;
        }
    }

    function setWarning(
        key,
        title,
        message
    ) {
        const previous =
            warnings.get(key);

        if (
            previous?.title ===
                title &&
            previous?.message ===
                message
        ) {
            return;
        }

        warnings.set(
            key,
            {
                title,
                message,
                time: Date.now()
            }
        );

        refreshPopup();
    }

    function clearWarning(key) {
        if (
            warnings.delete(key)
        ) {
            refreshPopup();
        }
    }

    function addFeedLog(
        petId,
        petName,
        threshold,
        before,
        after
    ) {
        feedLogs.unshift({
            petId,
            petName,
            threshold,
            before,
            after,
            time: Date.now()
        });

        if (
            feedLogs.length >
            MAX_LOGS
        ) {
            feedLogs.length =
                MAX_LOGS;
        }

        refreshPopup();
    }

    function clearCurrentTab() {
        if (
            currentTab ===
            "feed"
        ) {
            feedLogs.length = 0;
        }

        if (
            currentTab ===
            "warning"
        ) {
            warnings.clear();
        }

        refreshPopup();
    }

    function confirmFeeds() {
        const now =
            Date.now();

        for (
            const [petId, pending]
            of pendingFeeds
        ) {
            if (
                now - pending.time >
                CONFIRM_MS
            ) {
                pendingFeeds.delete(
                    petId
                );

                continue;
            }

            const pet =
                activePets.find(
                    item =>
                        getPetId(item) ===
                        petId
                );

            if (!pet) {
                continue;
            }

            const hunger =
                getHunger(pet);

            if (
                Number.isFinite(
                    hunger
                ) &&
                hunger >
                    pending.before +
                        0.01
            ) {
                pendingFeeds.delete(
                    petId
                );

                addFeedLog(
                    petId,
                    pending.name,
                    pending.threshold,
                    pending.before,
                    hunger
                );
            }
        }
    }

    async function subscribePets() {
        if (
            subscribing ||
            typeof unsubscribe ===
                "function"
        ) {
            return;
        }

        const service =
            getService();

        if (
            typeof service
                ?.onPetsChangeNow !==
                "function" ||
            typeof service
                ?.getHungerPctFor !==
                "function"
        ) {
            setWarning(
                "service",
                "Arie’s Mod",
                "활성 펫 서비스를 기다리고 있습니다."
            );

            return;
        }

        subscribing = true;

        try {
            const stop =
                await service
                    .onPetsChangeNow(
                        pets => {
                            activePets =
                                Array.isArray(
                                    pets
                                )
                                    ? pets
                                        .filter(
                                            pet =>
                                                getPetId(
                                                    pet
                                                )
                                        )
                                        .slice(
                                            0,
                                            MAX_PETS
                                        )
                                    : [];

                            confirmFeeds();

                            clearWarning(
                                "service"
                            );

                            if (
                                activePets
                                    .length
                            ) {
                                clearWarning(
                                    "pets"
                                );
                            }
                        }
                    );

            unsubscribe =
                typeof stop ===
                "function"
                    ? stop
                    : () => {};

            clearWarning(
                "service"
            );
        } catch {
            unsubscribe = null;

            setWarning(
                "service",
                "Arie’s Mod",
                "활성 펫 데이터 구독에 실패했습니다."
            );
        } finally {
            subscribing = false;
        }
    }

    function feedPet(
        petId,
        name,
        hunger,
        threshold,
        button
    ) {
        if (
            pendingFeeds.has(
                petId
            )
        ) {
            return;
        }

        if (
            !button ||
            !button.isConnected
        ) {
            setWarning(
                `button-${petId}`,
                name,
                "Instant Feed 버튼을 찾지 못했습니다."
            );

            return;
        }

        if (
            text(
                button.dataset.petId
            ) !== petId
        ) {
            setWarning(
                `button-${petId}`,
                name,
                "급여 버튼의 펫 ID가 일치하지 않습니다."
            );

            return;
        }

        try {
            pendingFeeds.set(
                petId,
                {
                    name,
                    before: hunger,
                    threshold,
                    time: Date.now()
                }
            );

            button.click();

            clearWarning(
                `button-${petId}`
            );
        } catch {
            pendingFeeds.delete(
                petId
            );

            setWarning(
                `button-${petId}`,
                name,
                "급여 버튼 클릭 중 오류가 발생했습니다."
            );
        }
    }

    async function checkPets() {
        if (
            checking ||
            !isEnabled()
        ) {
            return;
        }

        checking = true;

        try {
            enableInstantFeedWidget();
            hideInstantFeedWidget();
            confirmFeeds();

            if (
                typeof unsubscribe !==
                "function"
            ) {
                await subscribePets();
            }

            if (
                !activePets.length
            ) {
                setWarning(
                    "pets",
                    "활성 펫",
                    "활성 펫 데이터를 아직 받지 못했습니다."
                );

                return;
            }

            clearWarning(
                "pets"
            );

            for (
                let index = 0;
                index <
                activePets.length;
                index++
            ) {
                const pet =
                    activePets[index];

                const petId =
                    getPetId(pet);

                const hunger =
                    getHunger(pet);

                const rule =
                    getAlertRule(
                        petId
                    );

                const button =
                    findFeedButton(
                        petId
                    );

                const name =
                    getPetName(
                        petId,
                        pet,
                        index
                    );

                if (
                    !Number.isFinite(
                        hunger
                    )
                ) {
                    setWarning(
                        `hunger-${petId}`,
                        name,
                        "배고픔 수치를 계산하지 못했습니다."
                    );

                    continue;
                }

                clearWarning(
                    `hunger-${petId}`
                );

                if (!button) {
                    setWarning(
                        `button-${petId}`,
                        name,
                        "같은 펫 ID의 Instant Feed 버튼을 찾지 못했습니다."
                    );

                    continue;
                }

                clearWarning(
                    `button-${petId}`
                );

                if (
                    rule.enabled &&
                    hunger <=
                        rule.threshold
                ) {
                    feedPet(
                        petId,
                        name,
                        hunger,
                        rule.threshold,
                        button
                    );
                }
            }
        } catch {
            setWarning(
                "check",
                "자동 급여",
                "펫 검사 중 오류가 발생했습니다."
            );
        } finally {
            checking = false;
        }
    }

    function installStyle() {
        if (
            document.getElementById(
                ID.style
            )
        ) {
            return;
        }

        const style =
            document.createElement(
                "style"
            );

        style.id =
            ID.style;

        style.textContent = `
            #${ID.ui}{
                position:fixed;
                left:6px;
                top:calc(50% - 144px);
                z-index:2147483647;
                display:flex;
                gap:4px;
                align-items:center
            }

            #${ID.ui} button,
            #${ID.popup} button{
                box-sizing:border-box;
                border:1px solid #737b86;
                border-radius:6px;
                background:linear-gradient(#555e69,#343b44);
                color:#fff;
                font-weight:800;
                cursor:pointer
            }

            #${ID.ui} button{
                height:25px;
                min-width:25px;
                padding:0 6px;
                font-size:13px;
                box-shadow:0 2px 6px rgba(0,0,0,.35)
            }

            #${ID.toggle}{
                min-width:56px!important
            }

            #${ID.toggle}.enabled{
                border-color:#60d99d;
                background:linear-gradient(#27ad72,#14764f)
            }

            #${ID.message}.warning{
                border-color:#d6a836;
                background:linear-gradient(#8c6b16,#59440f)
            }

            #${ID.message}.logged:not(.warning){
                border-color:#60d99d;
                background:linear-gradient(#278a61,#18563f)
            }

            #${ID.popup}{
                position:fixed;
                left:88px;
                top:calc(50% - 112px);
                z-index:2147483647;
                width:270px;
                max-height:430px;
                display:none;
                overflow:hidden;
                padding:12px;
                border:1px solid rgba(255,255,255,.24);
                border-radius:9px;
                background:rgba(24,28,34,.97);
                color:#fff;
                font-size:12px;
                line-height:1.5;
                box-shadow:0 6px 22px rgba(0,0,0,.62)
            }

            .jh-head,
            .jh-tabs{
                display:flex;
                gap:4px;
                align-items:center
            }

            .jh-head{
                justify-content:space-between;
                margin-bottom:9px
            }

            .jh-tabs{
                margin-bottom:9px
            }

            .jh-tab{
                flex:1;
                height:29px;
                padding:0 4px;
                font-size:11px
            }

            .jh-tab.active{
                border-color:#79aee8!important;
                background:linear-gradient(#59636e,#3b424b)!important
            }

            .jh-content{
                max-height:335px;
                overflow-y:auto
            }

            .jh-row{
                padding:9px 0;
                border-bottom:1px solid rgba(255,255,255,.12)
            }

            .jh-time{
                margin-top:4px;
                opacity:.65;
                font-size:11px
            }

            .jh-empty{
                padding:28px 8px;
                text-align:center;
                opacity:.58
            }

            .jh-hide-feed-widget{
                position:fixed!important;
                left:-10000px!important;
                top:-10000px!important;
                visibility:hidden!important;
                opacity:0!important;
                pointer-events:none!important
            }
        `;

        document.head.appendChild(
            style
        );
    }

    function renderFeedTab() {
        if (
            !feedLogs.length
        ) {
            return `
                <div class="jh-empty">
                    급여 기록이 없습니다.
                </div>
            `;
        }

        return feedLogs
            .map(item => `
                <div class="jh-row">
                    <div style="
                        color:#7ee2ad;
                        font-weight:900
                    ">
                        🍓 급여 완료
                    </div>

                    <div style="
                        margin-top:3px;
                        font-weight:800
                    ">
                        ${escapeHTML(
                            item.petName
                        )}
                    </div>

                    <div style="
                        margin-top:3px
                    ">
                        급여 임계값:
                        ${escapeHTML(
                            formatPercent(
                                item.threshold
                            )
                        )}
                    </div>

                    <div>
                        배고픔:
                        ${escapeHTML(
                            formatPercent(
                                item.before
                            )
                        )}
                        →
                        ${escapeHTML(
                            formatPercent(
                                item.after
                            )
                        )}
                    </div>

                    <div class="jh-time">
                        ${escapeHTML(
                            formatTime(
                                item.time
                            )
                        )}
                    </div>
                </div>
            `)
            .join("");
    }

    function renderWarningTab() {
        const items =
            Array.from(
                warnings.values()
            ).sort(
                (a, b) =>
                    b.time -
                    a.time
            );

        if (
            !items.length
        ) {
            return `
                <div class="jh-empty">
                    경고가 없습니다.
                </div>
            `;
        }

        return items
            .map(item => `
                <div class="jh-row">
                    <div style="
                        color:#f2c96d;
                        font-weight:900
                    ">
                        ⚠️ ${escapeHTML(
                            item.title
                        )}
                    </div>

                    <div style="
                        margin-top:3px
                    ">
                        ${escapeHTML(
                            item.message
                        )}
                    </div>

                    <div class="jh-time">
                        ${escapeHTML(
                            formatTime(
                                item.time
                            )
                        )}
                    </div>
                </div>
            `)
            .join("");
    }

    function renderHelpTab() {
        return `
            <div style="
                padding:4px 1px
            ">
                <div style="
                    font-size:14px;
                    font-weight:900;
                    margin-bottom:10px
                ">
                    JH Pet Auto Feed
                </div>

                <div style="
                    margin-bottom:10px
                ">
                    <b>알림</b><br>
                    Arie’s Mod → Pets → Alerts에서
                    공통 또는 개별 임계값을 설정합니다.
                </div>

                <div style="
                    margin-bottom:10px
                ">
                    <b>먹이</b><br>
                    Arie’s Mod → Pets → Feeding에서
                    급여할 작물을 선택합니다.
                </div>

                <div style="
                    color:#f2c96d
                ">
                    작물이 인벤토리에 있어야 합니다.<br>
                    Instant Feed Widget은 자동으로 숨겨집니다.
                </div>
            </div>
        `;
    }

    function refreshPopup() {
        const button =
            document.getElementById(
                ID.message
            );

        const popup =
            document.getElementById(
                ID.popup
            );

        if (button) {
            button.classList.toggle(
                "warning",
                warnings.size >
                    0
            );

            button.classList.toggle(
                "logged",
                feedLogs.length >
                    0
            );

            button.textContent =
                "☰";

            button.title =
                `급여 기록 ${feedLogs.length}건 · 경고 ${warnings.size}건 · 도움말`;
        }

        if (!popup) {
            return;
        }

        const content =
            currentTab ===
            "feed"
                ? renderFeedTab()
                : currentTab ===
                    "warning"
                    ? renderWarningTab()
                    : renderHelpTab();

        popup.innerHTML = `
            <div class="jh-head">
                <b style="
                    font-size:14px
                ">
                    JH Pet Auto Feed
                </b>

                ${
                    currentTab !==
                    "help"
                        ? `
                            <button
                                class="jh-clear"
                                style="
                                    padding:3px 7px;
                                    font-size:11px
                                "
                            >
                                지우기
                            </button>
                        `
                        : ""
                }
            </div>

            <div class="jh-tabs">
                <button
                    class="jh-tab ${
                        currentTab ===
                        "feed"
                            ? "active"
                            : ""
                    }"
                    data-tab="feed"
                >
                    🍓 기록 (${feedLogs.length})
                </button>

                <button
                    class="jh-tab ${
                        currentTab ===
                        "warning"
                            ? "active"
                            : ""
                    }"
                    data-tab="warning"
                >
                    ⚠️ 경고 (${warnings.size})
                </button>

                <button
                    class="jh-tab ${
                        currentTab ===
                        "help"
                            ? "active"
                            : ""
                    }"
                    data-tab="help"
                >
                    도움말
                </button>
            </div>

            <div class="jh-content">
                ${content}
            </div>
        `;

        popup
            .querySelectorAll(
                "[data-tab]"
            )
            .forEach(tab => {
                tab.onclick =
                    event => {
                        event
                            .stopPropagation();

                        currentTab =
                            tab.dataset.tab;

                        refreshPopup();
                    };
            });

        popup
            .querySelector(
                ".jh-clear"
            )
            ?.addEventListener(
                "click",
                event => {
                    event
                        .stopPropagation();

                    clearCurrentTab();
                }
            );
    }

    function createUI() {
        if (
            !document.body ||
            document.getElementById(
                ID.ui
            )
        ) {
            return;
        }

        installStyle();

        const ui =
            document.createElement(
                "div"
            );

        const popup =
            document.createElement(
                "div"
            );

        ui.id =
            ID.ui;

        popup.id =
            ID.popup;

        ui.innerHTML = `
            <button id="${ID.toggle}">
                🍓 ON
            </button>

            <button
                id="${ID.message}"
                title="급여 기록, 경고 및 도움말"
            >
                ☰
            </button>
        `;

        document.body.append(
            ui,
            popup
        );

        document
            .getElementById(
                ID.toggle
            )
            .onclick =
                event => {
                    event
                        .stopPropagation();

                    setEnabled(
                        !isEnabled()
                    );
                };

        document
            .getElementById(
                ID.message
            )
            .onclick =
                event => {
                    event
                        .stopPropagation();

                    const open =
                        popup.style
                            .display !==
                        "block";

                    popup.style
                        .display =
                        open
                            ? "block"
                            : "none";

                    if (!open) {
                        return;
                    }

                    if (
                        warnings.size &&
                        !feedLogs.length
                    ) {
                        currentTab =
                            "warning";
                    } else if (
                        feedLogs.length &&
                        !warnings.size
                    ) {
                        currentTab =
                            "feed";
                    } else if (
                        !feedLogs.length &&
                        !warnings.size
                    ) {
                        currentTab =
                            "help";
                    }

                    refreshPopup();
                };

        popup.onclick =
            event =>
                event
                    .stopPropagation();

        updateToggle();
        refreshPopup();
    }

    function start() {
        createUI();
        enableInstantFeedWidget();
        void subscribePets();
    }

    if (document.body) {
        start();
    } else {
        const observer =
            new MutationObserver(
                () => {
                    if (
                        !document.body
                    ) {
                        return;
                    }

                    observer
                        .disconnect();

                    start();
                }
            );

        observer.observe(
            document.documentElement,
            {
                childList: true,
                subtree: true
            }
        );
    }

    document.addEventListener(
        "click",
        () => {
            const popup =
                document.getElementById(
                    ID.popup
                );

            if (popup) {
                popup.style
                    .display =
                    "none";
            }
        }
    );

    setInterval(
        () => {
            createUI();
            enableInstantFeedWidget();
            hideInstantFeedWidget();

            void checkPets();
        },
        CHECK_MS
    );

    setTimeout(
        () => {
            void checkPets();
        },
        2000
    );
})();