document.addEventListener("DOMContentLoaded", async () => {
  // ================= WEB CRYPTO API =================
  let cachedCryptoKey = null;
  let currentActiveDomain = "";

  async function deriveKey(masterPassword, salt) {
    const enc = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
      "raw", enc.encode(masterPassword), "PBKDF2", false, ["deriveKey"]
    );
    return crypto.subtle.deriveKey(
      { name: "PBKDF2", salt: salt, iterations: 100000, hash: "SHA-256" },
      keyMaterial,
      { name: "AES-GCM", length: 256 },
      true,
      ["encrypt", "decrypt"]
    );
  }

  async function encryptData(dataObj, key) {
    const enc = new TextEncoder();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const plaintext = enc.encode(JSON.stringify(dataObj));
    const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv }, key, plaintext);
    return { iv: Array.from(iv), cipher: Array.from(new Uint8Array(ciphertext)) };
  }

  async function decryptData(encryptedObj, key) {
    try {
      const iv = new Uint8Array(encryptedObj.iv);
      const ciphertext = new Uint8Array(encryptedObj.cipher);
      const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv: iv }, key, ciphertext);
      return JSON.parse(new TextDecoder().decode(decrypted));
    } catch (e) {
      return null;
    }
  }

  // SHA-1 Hesaplama (Sızıntı Kontrolü İçin)
  async function sha1Hex(str) {
    const buffer = new TextEncoder().encode(str);
    const hashBuffer = await crypto.subtle.digest("SHA-1", buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, "0")).join("").toUpperCase();
  }

  // ================= OTURUM KORUMA =================
  async function saveKeyToSession(key) {
    try {
      const exported = await crypto.subtle.exportKey("raw", key);
      const keyArray = Array.from(new Uint8Array(exported));
      if (chrome.storage.session) {
        await chrome.storage.session.set({ vaultSessionKey: keyArray });
      }
    } catch (e) {}
  }

  async function loadKeyFromSession() {
    return new Promise((resolve) => {
      if (!chrome.storage.session) return resolve(null);
      chrome.storage.session.get(["vaultSessionKey"], async (res) => {
        if (!res.vaultSessionKey) return resolve(null);
        try {
          const rawKey = new Uint8Array(res.vaultSessionKey);
          const imported = await crypto.subtle.importKey(
            "raw",
            rawKey,
            { name: "AES-GCM", length: 256 },
            true,
            ["encrypt", "decrypt"]
          );
          resolve(imported);
        } catch (e) {
          resolve(null);
        }
      });
    });
  }

  function detectCurrentSite() {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.url) {
        try {
          const url = new URL(tabs[0].url);
          if (!url.protocol.startsWith("chrome")) {
            currentActiveDomain = url.hostname.replace(/^www\./, "").toLowerCase();
            const siteInput = document.getElementById("siteName");
            if (siteInput && !siteInput.value) {
              siteInput.value = currentActiveDomain;
            }
          }
        } catch (e) {}
      }
      renderAccounts();
    });
  }

  function isDomainMatch(siteField, targetDomain) {
    if (!siteField || !targetDomain) return false;
    const cleanSite = siteField.toLowerCase().replace(/^(https?:\/\/)?(www\.)?/, "").split("/")[0].trim();
    const cleanTarget = targetDomain.toLowerCase().replace(/^www\./, "").trim();
    return cleanTarget.includes(cleanSite) || cleanSite.includes(cleanTarget);
  }

  function updateDatalistWithSavedSites(accounts) {
    const datalist = document.getElementById("popularSites");
    if (!datalist) return;
    const existingValues = new Set(Array.from(datalist.options).map((o) => o.value.toLowerCase()));
    accounts.forEach((acc) => {
      if (acc.site && !existingValues.has(acc.site.toLowerCase())) {
        const opt = document.createElement("option");
        opt.value = acc.site;
        opt.textContent = "Kayıtlı Siteniz";
        datalist.appendChild(opt);
        existingValues.add(acc.site.toLowerCase());
      }
    });
  }

  // ================= KİLİT SİSTEMİ =================
  const lockScreen = document.getElementById("lockScreen");
  const appContent = document.getElementById("appContent");
  const lockSubtitle = document.getElementById("lockSubtitle");
  const masterPassInput = document.getElementById("masterPassInput");
  const masterPassConfirm = document.getElementById("masterPassConfirm");
  const btnUnlock = document.getElementById("btnUnlock");
  const lockStatus = document.getElementById("lockStatus");
  const btnLockApp = document.getElementById("btnLockApp");

  let isFirstSetup = false;

  const existingKey = await loadKeyFromSession();
  if (existingKey) {
    cachedCryptoKey = existingKey;
    unlockVault();
  } else {
    chrome.storage.local.get(["vaultSalt", "vaultVerifier"], (res) => {
      if (!res.vaultSalt || !res.vaultVerifier) {
        isFirstSetup = true;
        lockSubtitle.textContent = "Kasanızı korumak için yeni bir Ana Şifre belirleyin.";
        masterPassConfirm.style.display = "block";
        btnUnlock.textContent = "Kasayı Oluştur ve Aç";
      }
    });
  }

  btnUnlock.addEventListener("click", async () => {
    const pass = masterPassInput.value;
    const confirmPass = masterPassConfirm.value;

    if (!pass || pass.length < 4) {
      lockStatus.textContent = "Şifre en az 4 karakter olmalıdır.";
      return;
    }

    if (isFirstSetup) {
      if (pass !== confirmPass) {
        lockStatus.textContent = "Şifreler uyuşmuyor!";
        return;
      }
      const salt = crypto.getRandomValues(new Uint8Array(16));
      cachedCryptoKey = await deriveKey(pass, salt);
      const verifier = await encryptData({ test: "valid_token" }, cachedCryptoKey);

      chrome.storage.local.set({
        vaultSalt: Array.from(salt),
        vaultVerifier: verifier,
        encAccounts: null,
        encCards: null,
        encNotes: null
      }, async () => {
        await saveKeyToSession(cachedCryptoKey);
        unlockVault();
      });
    } else {
      chrome.storage.local.get(["vaultSalt", "vaultVerifier"], async (res) => {
        const salt = new Uint8Array(res.vaultSalt);
        const derived = await deriveKey(pass, salt);
        const verified = await decryptData(res.vaultVerifier, derived);

        if (verified && verified.test === "valid_token") {
          cachedCryptoKey = derived;
          await saveKeyToSession(cachedCryptoKey);
          unlockVault();
        } else {
          lockStatus.textContent = "Hatalı Ana Şifre!";
        }
      });
    }
  });

  function unlockVault() {
    lockScreen.style.display = "none";
    appContent.style.display = "block";
    masterPassInput.value = "";
    masterPassConfirm.value = "";
    lockStatus.textContent = "";
    detectCurrentSite();
    renderSavedCards();
    renderSavedNotes();
    loadCurrentTempEmail();
  }

  btnLockApp.addEventListener("click", () => {
    cachedCryptoKey = null;
    if (chrome.storage.session) {
      chrome.storage.session.remove("vaultSessionKey");
    }
    appContent.style.display = "none";
    lockScreen.style.display = "flex";
    btnUnlock.textContent = "Kasayı Aç";
    lockSubtitle.textContent = "Kasanıza erişmek için ana şifrenizi girin.";
    masterPassConfirm.style.display = "none";
    isFirstSetup = false;
  });

  // ================= SEKME GEÇİŞLERİ =================
  const tabButtons = document.querySelectorAll(".tab-btn");
  const tabContents = document.querySelectorAll(".tab-content");

  tabButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      tabButtons.forEach((b) => b.classList.remove("active"));
      tabContents.forEach((c) => {
        c.classList.remove("active");
        c.style.display = "none";
      });

      btn.classList.add("active");
      const targetId = btn.getAttribute("data-tab");
      const targetContent = document.getElementById(targetId);
      if (targetContent) {
        targetContent.classList.add("active");
        targetContent.style.display = "block";
      }
    });
  });

  // ================= ŞİFRE ÜRETİCİ =================
  const passLengthInput = document.getElementById("passLength");
  const passLengthVal = document.getElementById("passLengthVal");
  const chkUpper = document.getElementById("chkUpper");
  const chkLower = document.getElementById("chkLower");
  const chkNumbers = document.getElementById("chkNumbers");
  const chkSymbols = document.getElementById("chkSymbols");
  const genPassOut = document.getElementById("genPassOut");

  passLengthInput.addEventListener("input", (e) => {
    passLengthVal.textContent = e.target.value;
  });

  function generateCustomPassword() {
    const uppers = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    const lowers = "abcdefghijklmnopqrstuvwxyz";
    const numbers = "0123456789";
    const symbols = "!@#$%^&*()_+~|}{[]:;?><,.-=";

    let availableChars = "";
    let mandatoryChars = [];

    if (chkUpper.checked) { availableChars += uppers; mandatoryChars.push(uppers.charAt(Math.floor(Math.random() * uppers.length))); }
    if (chkLower.checked) { availableChars += lowers; mandatoryChars.push(lowers.charAt(Math.floor(Math.random() * lowers.length))); }
    if (chkNumbers.checked) { availableChars += numbers; mandatoryChars.push(numbers.charAt(Math.floor(Math.random() * numbers.length))); }
    if (chkSymbols.checked) { availableChars += symbols; mandatoryChars.push(symbols.charAt(Math.floor(Math.random() * symbols.length))); }

    if (!availableChars) { alert("En az bir karakter türü seçin!"); return ""; }

    const length = parseInt(passLengthInput.value, 10);
    let pwd = [...mandatoryChars];
    for (let i = pwd.length; i < length; i++) {
      pwd.push(availableChars.charAt(Math.floor(Math.random() * availableChars.length)));
    }
    for (let i = pwd.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pwd[i], pwd[j]] = [pwd[j], pwd[i]];
    }
    return pwd.join("").substring(0, length);
  }

  document.getElementById("btnGenPass").addEventListener("click", () => {
    const pwd = generateCustomPassword();
    if (pwd) genPassOut.value = pwd;
  });

  document.getElementById("btnUseGenPass").addEventListener("click", () => {
    if (genPassOut.value) document.getElementById("accPass").value = genPassOut.value;
  });

  // ================= PAROLA SIZINTI KONTROLÜ (PWNED PASSWORDS) =================
  const accPassInput = document.getElementById("accPass");
  const btnCheckLeak = document.getElementById("btnCheckLeak");
  const leakBanner = document.getElementById("leakBanner");

  btnCheckLeak.addEventListener("click", async () => {
    const password = accPassInput.value;
    if (!password) {
      alert("Lütfen önce kontrol edilecek bir şifre girin.");
      return;
    }

    btnCheckLeak.textContent = "Taranıyor...";
    leakBanner.style.display = "none";

    try {
      const hash = await sha1Hex(password);
      const prefix = hash.substring(0, 5);
      const suffix = hash.substring(5);

      const res = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`);
      const text = await res.text();

      const lines = text.split("\n");
      let leakCount = 0;

      for (const line of lines) {
        const [hashSuffix, count] = line.trim().split(":");
        if (hashSuffix === suffix) {
          leakCount = parseInt(count, 10);
          break;
        }
      }

      leakBanner.style.display = "block";
      if (leakCount > 0) {
        leakBanner.style.background = "rgba(239, 68, 68, 0.2)";
        leakBanner.style.border = "1px solid var(--danger)";
        leakBanner.style.color = "#f87171";
        leakBanner.innerHTML = `⚠️ DİKKAT: Bu şifre daha önce <strong>${leakCount.toLocaleString()}</strong> kez internete sızdırılmış! Kullanmayın.`;
      } else {
        leakBanner.style.background = "rgba(16, 185, 129, 0.2)";
        leakBanner.style.border = "1px solid var(--success)";
        leakBanner.style.color = "#34d399";
        leakBanner.innerHTML = `✅ GÜVENLİ: Bu şifre bilinen sızıntı listelerinde bulunamadı.`;
      }
    } catch (e) {
      alert("Sızıntı veri tabanına erişilemedi.");
    } finally {
      btnCheckLeak.textContent = "Sızıntı Tara 🔍";
    }
  });

  // ================= HESAP / ŞİFRE DEPOLAMA =================
  const siteNameInput = document.getElementById("siteName");
  const accEmailInput = document.getElementById("accEmail");
  const editAccountIdInput = document.getElementById("editAccountId");
  const accountFormTitle = document.getElementById("accountFormTitle");
  const savedAccountsContainer = document.getElementById("savedAccountsContainer");

  async function getDecryptedAccounts() {
    return new Promise((resolve) => {
      chrome.storage.local.get(["encAccounts"], async (res) => {
        if (!res.encAccounts || !cachedCryptoKey) return resolve([]);
        const data = await decryptData(res.encAccounts, cachedCryptoKey);
        resolve(data || []);
      });
    });
  }

  async function saveDecryptedAccounts(list) {
    const enc = await encryptData(list, cachedCryptoKey);
    return new Promise((resolve) => {
      chrome.storage.local.set({ encAccounts: enc }, resolve);
    });
  }

  async function renderAccounts() {
    const list = await getDecryptedAccounts();
    updateDatalistWithSavedSites(list);
    savedAccountsContainer.innerHTML = "";
    if (list.length === 0) {
      savedAccountsContainer.innerHTML = `<span style="font-size: 11px; color: #64748b;">Henüz kayıtlı hesap yok.</span>`;
      return;
    }

    const sortedList = [...list].sort((a, b) => {
      const aMatch = isDomainMatch(a.site, currentActiveDomain);
      const bMatch = isDomainMatch(b.site, currentActiveDomain);
      if (aMatch && !bMatch) return -1;
      if (!aMatch && bMatch) return 1;
      return 0;
    });

    sortedList.forEach((acc) => {
      const isMatched = isDomainMatch(acc.site, currentActiveDomain);
      const item = document.createElement("div");
      item.className = "list-item";
      if (isMatched) {
        item.style.borderColor = "#3b82f6";
        item.style.background = "#131f38";
      }

      item.innerHTML = `
        <div style="max-width: 140px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
          <strong>${acc.site || "Genel"}</strong> ${isMatched ? '<span style="color:#60a5fa; font-size:9px; font-weight:700;">★ Bu Site</span>' : ''}<br>
          <span style="color:#94a3b8; font-size: 11px;">${acc.email}</span>
        </div>
        <div class="item-actions">
          <button class="secondary" data-id="${acc.id}" data-action="copy-email" title="E-Postayı Kopyala">Posta</button>
          <button class="secondary" data-id="${acc.id}" data-action="copy-pass" title="Şifreyi Kopyala">Şifre</button>
          <button class="secondary" data-id="${acc.id}" data-action="edit">Düzenle</button>
          <button class="danger" data-id="${acc.id}" data-action="del">Sil</button>
        </div>
      `;
      savedAccountsContainer.appendChild(item);
    });
  }

  document.getElementById("btnSaveAccount").addEventListener("click", async () => {
    const site = siteNameInput.value.trim();
    const email = accEmailInput.value.trim();
    const password = accPassInput.value.trim();
    const editId = editAccountIdInput.value;

    if (!email || !password) { alert("E-posta ve şifre alanlarını doldurun."); return; }

    let list = await getDecryptedAccounts();
    if (editId) {
      const idx = list.findIndex((a) => a.id === editId);
      if (idx !== -1) list[idx] = { id: editId, site, email, password };
    } else {
      list.push({ id: Date.now().toString(), site, email, password });
    }

    await saveDecryptedAccounts(list);
    siteNameInput.value = currentActiveDomain || "";
    accEmailInput.value = ""; 
    accPassInput.value = ""; 
    editAccountIdInput.value = "";
    leakBanner.style.display = "none";
    accountFormTitle.textContent = "Hesap Bilgisi Ekle / Düzenle";
    const status = document.getElementById("accountStatus");
    status.textContent = "Kaydedildi!";
    setTimeout(() => status.textContent = "", 2000);
    renderAccounts();
  });

  savedAccountsContainer.addEventListener("click", async (e) => {
    const id = e.target.getAttribute("data-id");
    const action = e.target.getAttribute("data-action");
    if (!id || !action) return;

    let list = await getDecryptedAccounts();
    const target = list.find((a) => a.id === id);

    if (action === "del") {
      list = list.filter((a) => a.id !== id);
      await saveDecryptedAccounts(list);
      renderAccounts();
    } else if (action === "edit" && target) {
      siteNameInput.value = target.site || "";
      accEmailInput.value = target.email || "";
      accPassInput.value = target.password || "";
      editAccountIdInput.value = target.id;
      leakBanner.style.display = "none";
      accountFormTitle.textContent = "Hesabı Güncelle";
    } else if (action === "copy-pass" && target) {
      navigator.clipboard.writeText(target.password);
      alert("Şifre kopyalandı!");
    } else if (action === "copy-email" && target) {
      navigator.clipboard.writeText(target.email);
      alert("E-posta adresi kopyalandı!");
    }
  });

  // ================= KART DEPOLAMA =================
  const holderInput = document.getElementById("cardHolder");
  const numberInput = document.getElementById("cardNumber");
  const expiryInput = document.getElementById("cardExpiry");
  const cvcInput = document.getElementById("cardCvc");
  const editIdInput = document.getElementById("editCardId");
  const cardFormTitle = document.getElementById("cardFormTitle");
  const savedCardsContainer = document.getElementById("savedCardsContainer");

  numberInput.addEventListener("input", (e) => {
    let val = e.target.value.replace(/\D/g, "");
    if (val.length > 16) val = val.substring(0, 16);
    e.target.value = val.match(/.{1,4}/g)?.join(" ") || "";
  });

  expiryInput.addEventListener("input", (e) => {
    let val = e.target.value.replace(/\D/g, "");
    if (val.length > 4) val = val.substring(0, 4);
    if (val.length >= 3) e.target.value = val.substring(0, 2) + "/" + val.substring(2);
    else if (val.length === 2 && e.inputType !== "deleteContentBackward") e.target.value = val + "/";
    else e.target.value = val;
  });

  cvcInput.addEventListener("input", (e) => {
    let val = e.target.value.replace(/\D/g, "");
    if (val.length > 3) val = val.substring(0, 3);
    e.target.value = val;
  });

  async function getDecryptedCards() {
    return new Promise((resolve) => {
      chrome.storage.local.get(["encCards"], async (res) => {
        if (!res.encCards || !cachedCryptoKey) return resolve([]);
        const data = await decryptData(res.encCards, cachedCryptoKey);
        resolve(data || []);
      });
    });
  }

  async function saveDecryptedCards(list) {
    const enc = await encryptData(list, cachedCryptoKey);
    return new Promise((resolve) => {
      chrome.storage.local.set({ encCards: enc }, resolve);
    });
  }

  async function renderSavedCards() {
    const list = await getDecryptedCards();
    savedCardsContainer.innerHTML = "";
    if (list.length === 0) {
      savedCardsContainer.innerHTML = `<span style="font-size: 11px; color: #64748b;">Henüz kayıtlı kart yok.</span>`;
      return;
    }
    list.forEach((c) => {
      const cleanNo = (c.number || "").replace(/\s+/g, "");
      const masked = cleanNo ? `**** ${cleanNo.slice(-4)}` : "****";
      const item = document.createElement("div");
      item.className = "list-item";
      item.innerHTML = `
        <div>
          <strong>${c.holder || "İsimsiz"}</strong><br>
          <span style="color:#94a3b8; font-size: 11px;">${masked} | ${c.expiry}</span>
        </div>
        <div class="item-actions">
          <button class="secondary" data-id="${c.id}" data-action="edit">Düzenle</button>
          <button class="danger" data-id="${c.id}" data-action="del">Sil</button>
        </div>
      `;
      savedCardsContainer.appendChild(item);
    });
  }

  document.getElementById("btnSaveCard").addEventListener("click", async () => {
    const holder = holderInput.value.trim();
    const rawNumber = numberInput.value.replace(/\s+/g, "").trim();
    const expiry = expiryInput.value.trim();
    const cvc = cvcInput.value.trim();
    const editId = editIdInput.value;

    if (rawNumber.length !== 16 || expiry.length < 5 || cvc.length !== 3) {
      alert("Lütfen kart bilgilerini eksiksiz girin.");
      return;
    }

    let list = await getDecryptedCards();
    if (editId) {
      const idx = list.findIndex((c) => c.id === editId);
      if (idx !== -1) list[idx] = { id: editId, holder, number: rawNumber, expiry, cvc };
    } else {
      list.push({ id: Date.now().toString(), holder, number: rawNumber, expiry, cvc });
    }

    await saveDecryptedCards(list);
    holderInput.value = ""; numberInput.value = ""; expiryInput.value = ""; cvcInput.value = ""; editIdInput.value = "";
    cardFormTitle.textContent = "Kart Bilgisi Ekle / Düzenle";
    const status = document.getElementById("cardStatus");
    status.textContent = "Kart kaydedildi!";
    setTimeout(() => status.textContent = "", 2000);
    renderSavedCards();
  });

  savedCardsContainer.addEventListener("click", async (e) => {
    const id = e.target.getAttribute("data-id");
    const action = e.target.getAttribute("data-action");
    if (!id || !action) return;

    let list = await getDecryptedCards();
    if (action === "del") {
      list = list.filter((c) => c.id !== id);
      await saveDecryptedCards(list);
      renderSavedCards();
    } else if (action === "edit") {
      const target = list.find((c) => c.id === id);
      if (target) {
        holderInput.value = target.holder || "";
        const clean = (target.number || "").replace(/\s+/g, "");
        numberInput.value = clean.match(/.{1,4}/g)?.join(" ") || clean;
        expiryInput.value = target.expiry || "";
        cvcInput.value = target.cvc || "";
        editIdInput.value = target.id;
        cardFormTitle.textContent = "Kartı Güncelle";
      }
    }
  });

  // ================= KRİPTOLU GÜVENLİ NOTLAR =================
  const noteTitleInput = document.getElementById("noteTitle");
  const noteContentInput = document.getElementById("noteContent");
  const editNoteIdInput = document.getElementById("editNoteId");
  const noteFormTitle = document.getElementById("noteFormTitle");
  const savedNotesContainer = document.getElementById("savedNotesContainer");

  async function getDecryptedNotes() {
    return new Promise((resolve) => {
      chrome.storage.local.get(["encNotes"], async (res) => {
        if (!res.encNotes || !cachedCryptoKey) return resolve([]);
        const data = await decryptData(res.encNotes, cachedCryptoKey);
        resolve(data || []);
      });
    });
  }

  async function saveDecryptedNotes(list) {
    const enc = await encryptData(list, cachedCryptoKey);
    return new Promise((resolve) => {
      chrome.storage.local.set({ encNotes: enc }, resolve);
    });
  }

  async function renderSavedNotes() {
    const list = await getDecryptedNotes();
    savedNotesContainer.innerHTML = "";
    if (list.length === 0) {
      savedNotesContainer.innerHTML = `<span style="font-size: 11px; color: #64748b;">Henüz kayıtlı güvenli not yok.</span>`;
      return;
    }
    list.forEach((n) => {
      const item = document.createElement("div");
      item.className = "list-item";
      item.innerHTML = `
        <div style="max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
          <strong>${n.title || "Başlıksız Not"}</strong><br>
          <span style="color:#94a3b8; font-size: 10px;">${n.content.substring(0, 30)}...</span>
        </div>
        <div class="item-actions">
          <button class="secondary" data-id="${n.id}" data-action="copy-note" title="Notu Kopyala">Kopya</button>
          <button class="secondary" data-id="${n.id}" data-action="edit">Düzenle</button>
          <button class="danger" data-id="${n.id}" data-action="del">Sil</button>
        </div>
      `;
      savedNotesContainer.appendChild(item);
    });
  }

  document.getElementById("btnSaveNote").addEventListener("click", async () => {
    const title = noteTitleInput.value.trim();
    const content = noteContentInput.value.trim();
    const editId = editNoteIdInput.value;

    if (!title || !content) {
      alert("Lütfen başlık ve not içeriğini girin.");
      return;
    }

    let list = await getDecryptedNotes();
    if (editId) {
      const idx = list.findIndex((n) => n.id === editId);
      if (idx !== -1) list[idx] = { id: editId, title, content };
    } else {
      list.push({ id: Date.now().toString(), title, content });
    }

    await saveDecryptedNotes(list);
    noteTitleInput.value = "";
    noteContentInput.value = "";
    editNoteIdInput.value = "";
    noteFormTitle.textContent = "Güvenli Not Ekle / Düzenle";
    const status = document.getElementById("noteStatus");
    status.textContent = "Not kaydedildi!";
    setTimeout(() => status.textContent = "", 2000);
    renderSavedNotes();
  });

  savedNotesContainer.addEventListener("click", async (e) => {
    const id = e.target.getAttribute("data-id");
    const action = e.target.getAttribute("data-action");
    if (!id || !action) return;

    let list = await getDecryptedNotes();
    const target = list.find((n) => n.id === id);

    if (action === "del") {
      list = list.filter((n) => n.id !== id);
      await saveDecryptedNotes(list);
      renderSavedNotes();
    } else if (action === "edit" && target) {
      noteTitleInput.value = target.title || "";
      noteContentInput.value = target.content || "";
      editNoteIdInput.value = target.id;
      noteFormTitle.textContent = "Notu Güncelle";
    } else if (action === "copy-note" && target) {
      navigator.clipboard.writeText(target.content);
      alert("Not panoya kopyalandı!");
    }
  });

  // ================= CANLI GEÇİCİ POSTA =================
  const tempEmailBox = document.getElementById("tempEmailBox");
  const inboxContainer = document.getElementById("inboxContainer");
  const mailDetailBox = document.getElementById("mailDetailBox");
  const mailDetailSubject = document.getElementById("mailDetailSubject");
  const mailDetailFrom = document.getElementById("mailDetailFrom");
  const mailDetailBody = document.getElementById("mailDetailBody");

  let currentSidToken = null;

  function loadCurrentTempEmail() {
    chrome.storage.local.get(["tempEmailAddress", "tempSidToken"], (res) => {
      if (res.tempEmailAddress && res.tempSidToken) {
        tempEmailBox.value = res.tempEmailAddress;
        currentSidToken = res.tempSidToken;
        fetchInbox();
      }
    });
  }

  document.getElementById("btnNewTempMail").addEventListener("click", async () => {
    tempEmailBox.value = "Oluşturuluyor...";
    try {
      const res = await fetch("https://api.guerrillamail.com/ajax.php?f=get_email_address");
      const data = await res.json();
      if (data && data.email_addr) {
        tempEmailBox.value = data.email_addr;
        currentSidToken = data.sid_token;
        chrome.storage.local.set({ 
          tempEmailAddress: data.email_addr,
          tempSidToken: data.sid_token
        });
        fetchInbox();
      }
    } catch (err) {
      tempEmailBox.value = "";
      alert("Geçici e-posta servisine erişilemedi!");
    }
  });

  document.getElementById("btnCopyTempMail").addEventListener("click", () => {
    if (tempEmailBox.value && tempEmailBox.value !== "Oluşturuluyor...") {
      navigator.clipboard.writeText(tempEmailBox.value);
      alert("Geçici e-posta adresi kopyalandı!");
    }
  });

  document.getElementById("btnUseTempInAccount").addEventListener("click", () => {
    if (tempEmailBox.value && tempEmailBox.value !== "Oluşturuluyor...") {
      accEmailInput.value = tempEmailBox.value;
      document.querySelector('[data-tab="tab-generator"]').click();
    }
  });

  document.getElementById("btnRefreshInbox").addEventListener("click", () => {
    fetchInbox();
  });

  async function fetchInbox() {
    if (!currentSidToken) return;
    inboxContainer.innerHTML = `<span style="font-size:11px;color:#94a3b8;">Kontrol ediliyor...</span>`;

    try {
      const res = await fetch(`https://api.guerrillamail.com/ajax.php?f=check_email&seq=0&sid_token=${currentSidToken}`);
      const data = await res.json();

      inboxContainer.innerHTML = "";
      const list = data.list || [];

      if (list.length === 0) {
        inboxContainer.innerHTML = `<span style="font-size: 11px; color: #64748b;">Posta kutusu boş. Henüz e-posta gelmedi.</span>`;
        return;
      }

      list.forEach((msg) => {
        const item = document.createElement("div");
        item.className = "list-item";
        item.style.cursor = "pointer";
        item.innerHTML = `
          <div style="max-width: 250px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
            <strong>${msg.mail_from}</strong><br>
            <span style="color:#94a3b8; font-size: 11px;">${msg.mail_subject || "(Konusuz)"}</span>
          </div>
          <button class="secondary" style="font-size: 10px;">Oku</button>
        `;
        item.addEventListener("click", () => readMessage(msg.mail_id));
        inboxContainer.appendChild(item);
      });
    } catch (e) {
      inboxContainer.innerHTML = `<span style="font-size: 11px; color: #ef4444;">Gelen kutusu kontrol edilemedi.</span>`;
    }
  }

  async function readMessage(mailId) {
    if (!currentSidToken) return;
    try {
      const res = await fetch(`https://api.guerrillamail.com/ajax.php?f=fetch_email&email_id=${mailId}&sid_token=${currentSidToken}`);
      const msg = await res.json();

      mailDetailSubject.textContent = msg.mail_subject;
      mailDetailFrom.textContent = `Kimden: ${msg.mail_from} | Tarih: ${msg.mail_date}`;
      mailDetailBody.innerHTML = msg.mail_body;

      mailDetailBox.style.display = "block";
    } catch (e) {
      alert("Mail okunamadı.");
    }
  }

  document.getElementById("btnCloseMailDetail").addEventListener("click", () => {
    mailDetailBox.style.display = "none";
  });
});