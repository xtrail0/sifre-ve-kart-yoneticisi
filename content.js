function setNativeValue(element, value) {
  const valueSetter = Object.getOwnPropertyDescriptor(element, "value")?.set;
  const prototype = Object.getPrototypeOf(element);
  const prototypeValueSetter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;

  if (prototypeValueSetter && valueSetter !== prototypeValueSetter) {
    prototypeValueSetter.call(element, value);
  } else if (valueSetter) {
    valueSetter.call(element, value);
  } else {
    element.value = value;
  }

  element.dispatchEvent(new Event("input", { bubbles: true, cancelable: true }));
  element.dispatchEvent(new Event("change", { bubbles: true, cancelable: true }));
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

async function getVaultItems() {
  return new Promise((resolve) => {
    if (!chrome.storage || !chrome.storage.session) {
      return resolve({ locked: true });
    }

    chrome.storage.session.get(["vaultSessionKey"], async (sess) => {
      if (!sess.vaultSessionKey) {
        return resolve({ locked: true });
      }

      try {
        const rawKey = new Uint8Array(sess.vaultSessionKey);
        const key = await crypto.subtle.importKey(
          "raw",
          rawKey,
          { name: "AES-GCM", length: 256 },
          false,
          ["decrypt"]
        );

        chrome.storage.local.get(["encAccounts", "encCards"], async (loc) => {
          const accounts = loc.encAccounts ? await decryptData(loc.encAccounts, key) : [];
          const cards = loc.encCards ? await decryptData(loc.encCards, key) : [];
          resolve({ locked: false, accounts: accounts || [], cards: cards || [] });
        });
      } catch (err) {
        resolve({ locked: true });
      }
    });
  });
}

// ================= ROZET VE MENÜ =================
let activeBadge = null;
let activeDropdown = null;

function removeUI() {
  if (activeBadge) { activeBadge.remove(); activeBadge = null; }
  if (activeDropdown) { activeDropdown.remove(); activeDropdown = null; }
}

document.addEventListener("click", (e) => {
  if (activeDropdown && !activeDropdown.contains(e.target) && !e.target.classList.contains("vault-badge-btn")) {
    if (activeDropdown) { activeDropdown.remove(); activeDropdown = null; }
  }
});

document.addEventListener("focusin", (e) => {
  const input = e.target;
  if (!input || input.tagName !== "INPUT") return;
  if (["hidden", "submit", "button", "checkbox", "radio", "file"].includes(input.type)) return;

  const attr = [input.name, input.id, input.placeholder, input.type].join(" ").toLowerCase();
  const isCard = attr.includes("card") || attr.includes("kart") || attr.includes("cvc") || attr.includes("pan");
  const isAuth = attr.includes("password") || attr.includes("pass") || attr.includes("user") || attr.includes("email") || input.type === "password";

  if (!isCard && !isAuth) return;

  attachBadge(input, isCard ? "card" : "auth");
});

function attachBadge(input, type) {
  if (activeBadge) activeBadge.remove();

  const rect = input.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return;

  const badge = document.createElement("button");
  badge.type = "button";
  badge.className = "vault-badge-btn";
  badge.textContent = "⚡";
  badge.title = "Kasa";

  Object.assign(badge.style, {
    position: "absolute",
    top: `${window.scrollY + rect.top + (rect.height / 2) - 11}px`,
    left: `${window.scrollX + rect.right - 26}px`,
    width: "22px",
    height: "22px",
    borderRadius: "50%",
    border: "none",
    background: "#3b82f6",
    color: "#ffffff",
    cursor: "pointer",
    fontSize: "12px",
    zIndex: "2147483647",
    padding: "0",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    boxShadow: "0 2px 4px rgba(0,0,0,0.3)"
  });

  badge.addEventListener("click", async (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    await renderMenu(badge, input, type);
  });

  document.body.appendChild(badge);
  activeBadge = badge;
}

async function renderMenu(badge, input, type) {
  if (activeDropdown) { activeDropdown.remove(); activeDropdown = null; }

  const vault = await getVaultItems();

  if (vault.locked) {
    alert("Kasa kilitli! Lütfen üstteki eklenti simgesine tıklayıp Ana Şifrenizi girin.");
    return;
  }

  const rect = badge.getBoundingClientRect();
  const menu = document.createElement("div");

  Object.assign(menu.style, {
    position: "absolute",
    top: `${window.scrollY + rect.bottom + 4}px`,
    left: `${window.scrollX + rect.left - 130}px`,
    width: "160px",
    background: "#0f172a",
    border: "1px solid #334155",
    borderRadius: "6px",
    padding: "4px",
    zIndex: "2147483647",
    fontFamily: "sans-serif",
    fontSize: "12px",
    color: "#f8fafc",
    boxShadow: "0 4px 12px rgba(0,0,0,0.4)"
  });

  const list = type === "card" ? vault.cards : vault.accounts;

  if (!list || list.length === 0) {
    menu.innerHTML = `<div style="padding:6px; color:#94a3b8; font-size:11px;">Kayıt yok</div>`;
  } else {
    list.forEach((item) => {
      const row = document.createElement("div");
      Object.assign(row.style, {
        padding: "6px",
        cursor: "pointer",
        borderRadius: "4px"
      });
      row.addEventListener("mouseenter", () => row.style.background = "#1e293b");
      row.addEventListener("mouseleave", () => row.style.background = "transparent");

      if (type === "card") {
        const clean = (item.number || "").replace(/\s+/g, "");
        row.innerHTML = `<strong>${item.holder || "Kart"}</strong><br><small style="color:#94a3b8">**** ${clean.slice(-4)}</small>`;
        row.addEventListener("click", () => {
          fillCard(item);
          removeUI();
        });
      } else {
        row.innerHTML = `<strong>${item.site || "Hesap"}</strong><br><small style="color:#94a3b8">${item.email}</small>`;
        row.addEventListener("click", () => {
          fillAuth(input, item);
          removeUI();
        });
      }
      menu.appendChild(row);
    });
  }

  document.body.appendChild(menu);
  activeDropdown = menu;
}

function fillAuth(input, acc) {
  const form = input.form || document;
  const userInput = form.querySelector('input[type="text"], input[type="email"]') || input;
  const passInput = form.querySelector('input[type="password"]');

  if (userInput && acc.email) setNativeValue(userInput, acc.email);
  if (passInput && acc.password) setNativeValue(passInput, acc.password);
}

function fillCard(card) {
  const inputs = Array.from(document.querySelectorAll("input"));
  inputs.forEach((input) => {
    const attr = [input.name, input.id, input.placeholder].join(" ").toLowerCase();
    if (attr.includes("card") || attr.includes("kart") || attr.includes("pan")) {
      setNativeValue(input, card.number);
    } else if (attr.includes("holder") || attr.includes("ad")) {
      if (card.holder) setNativeValue(input, card.holder);
    } else if (attr.includes("exp") || attr.includes("skt") || attr.includes("yy")) {
      if (card.expiry) setNativeValue(input, card.expiry);
    } else if (attr.includes("cvc") || attr.includes("cvv")) {
      if (card.cvc) setNativeValue(input, card.cvc);
    }
  });
}