const main = document.getElementById("main");

// ---------------- UI COMPONENTS ----------------
function showMessage(msg) {
    const result = document.getElementById("result");
    if (result) result.textContent = msg;
}

function loadAddProduct() {
    main.innerHTML = `
        <h1>Додати товар</h1>
        <label>Назва товару:</label>
        <input id="pname" class="input" placeholder="Назва товару">
        <label>Термін придатності:</label>
        <input id="pexp" type="date" class="input">
        <button class="btn" onclick="addProduct()">Створити</button>
        <div id="result"></div>
    `;
}

function loadInventory() {
    main.innerHTML = `
        <h1>Склад</h1>
        <button class="btn" onclick="getInventory()">Оновити</button>
        <div id="result">Завантаження…</div>
    `;
    getInventory();
}

function loadAnalytics() {
    main.innerHTML = `
        <h1>Аналітика</h1>
        <button class="btn" onclick="getAnalytics()">Оновити</button>
        <div id="result">Завантаження…</div>
    `;
    getAnalytics();
}


function loadExpirationPanel() {
    main.innerHTML = `
        <h1>Перевірка термінів придатності</h1>
        <button class="btn" onclick="runExpirationCheck()">Запустити перевірку</button>
        <div id="result">Очікування…</div>
    `;
}

// ---------------- BASIC REQUEST HANDLER ----------------
async function call(url, method = "GET", body = null, callback = null) {
    try {
        const options = { method, headers: {} };
        if (body) {
            options.headers["Content-Type"] = "application/json";
            options.body = JSON.stringify(body);
        }

        const res = await fetch(url, options);
        const data = await res.json();

        if (callback) callback(data);
        else showMessage(typeof data === "string" ? data : JSON.stringify(data, null, 2));
    } catch (e) {
        showMessage("Error: " + e.message);
    }
}

// ---------------- API ACTIONS ----------------

// Відображення складу
function showInventory(data) {
    const resultEl = document.getElementById("result");
    if (!data || !data.length) return showMessage("Склад порожній");

    let html = `<table border="1" style="border-collapse: collapse; width: 100%;">
        <tr>
            <th>Назва товару</th>
            <th>Термін придатності</th>
        </tr>`;
    data.forEach(p => {
        html += `<tr>
            <td>${p.name}</td>
            <td>${p.expiry}</td>
        </tr>`;
    });
    html += `</table>`;
    resultEl.innerHTML = html;
}

function getInventory() {
    call("http://localhost:3001/inventory", "GET", null, showInventory);
}

// Додавання товару
function addProduct() {
    const name = document.getElementById("pname").value;
    const expiry = document.getElementById("pexp").value;

    if (!name || !expiry) return showMessage("❗ Заповніть всі поля");

    call("http://localhost:3000/add", "POST", { name, expiry }, () => {
        showMessage(`Товар "${name}" додано!`);
        getInventory();
    });
}

// Відображення товарів за термінами придатності
function showExpirations(data) {
    const resultEl = document.getElementById("result");
    if (!data) return showMessage("Немає товарів для перевірки термінів придатності");

    let html = "<h2>Товари, що скоро списуються</h2>";

    ["30", "20", "10"].forEach(days => {
        const list = data[days];
        if (!list || list.length === 0) return;

        html += `<h3>Списується за ${days} днів</h3>`;
        html += `<table border="1" style="border-collapse: collapse; width: 100%;">
                    <tr>
                        <th>ID</th>
                        <th>Назва товару</th>
                        <th>Термін придатності</th>
                    </tr>`;
        list.forEach(p => {
            html += `<tr>
                        <td>${p.id}</td>
                        <td>${p.name}</td>
                        <td>${p.expiry}</td>
                    </tr>`;
        });
        html += `</table><br>`;
    });

    resultEl.innerHTML = html;
}

// Виконати перевірку термінів придатності
function runExpirationCheck() {
    call("http://localhost:3003/check", "GET", null, showExpirations);
}

// Аналітика
async function getAnalytics() {
    await call("http://localhost:3002/stats", "GET", null, showAnalyticsTable);
}
function showAnalyticsTable(data) {
    const resultEl = document.getElementById("result");
    if (!data || data.length === 0) {
        resultEl.innerHTML = "Немає подій для відображення";
        return;
    }

    let html = `<table border="1" style="border-collapse: collapse; width: 100%;">
        <tr>
            <th>Тип події</th>
            <th>Кількість</th>
        </tr>`;

    data.forEach(d => {
        html += `<tr>
            <td>${d._id}</td>
            <td>${d.count}</td>
        </tr>`;
    });

    html += `</table>`;
    resultEl.innerHTML = html;
}
