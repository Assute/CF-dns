const express = require('express');
const bodyParser = require('body-parser');
const session = require('express-session');
const axios = require('axios');
const https = require('https');
const { Resolver } = require('dns');
const fs = require('fs').promises;
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const forge = require('node-forge');

const app = express();
const PORT = 3600;
const DATA_DIR = path.join(__dirname, 'data');
const AUTH_FILE = path.join(DATA_DIR, 'auth.json');
const ACCOUNTS_FILE = path.join(DATA_DIR, 'accounts.json');
const CERTIFICATES_FILE = path.join(DATA_DIR, 'certificates.json');

const cloudflareResolver = new Resolver();
cloudflareResolver.setServers(['1.1.1.1', '8.8.8.8']);

function cloudflareLookup(hostname, options, callback) {
    if (typeof options === 'function') {
        callback = options;
        options = {};
    }

    cloudflareResolver.resolve4(hostname, (err4, addresses4) => {
        if (!err4 && addresses4 && addresses4.length > 0) {
            if (options?.all) {
                return callback(null, addresses4.map(address => ({ address, family: 4 })));
            }
            return callback(null, addresses4[0], 4);
        }

        cloudflareResolver.resolve6(hostname, (err6, addresses6) => {
            if (!err6 && addresses6 && addresses6.length > 0) {
                if (options?.all) {
                    return callback(null, addresses6.map(address => ({ address, family: 6 })));
                }
                return callback(null, addresses6[0], 6);
            }

            callback(err4 || err6 || new Error(`DNS lookup failed for ${hostname}`));
        });
    });
}

// 某些本地 DNS 对 Node 的响应异常，这里给 Cloudflare API 请求加公共 DNS 兜底
const cloudflareApi = axios.create({
    httpsAgent: new https.Agent({ lookup: cloudflareLookup }),
    timeout: 15000
});

app.use(bodyParser.json());
app.use(express.static('public'));

// 会话配置
app.use(session({
    secret: 'cf-dns-manager-secret-v2',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 24 * 60 * 60 * 1000 } // 24小时
}));

// 数据加载辅助函数
async function loadJson(file) {
    try {
        const data = await fs.readFile(file, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        return error.code === 'ENOENT' ? [] : null;
    }
}

async function saveJson(file, data) {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify(data, null, 2));
}

async function ensureJsonFile(file, defaultValue) {
    try {
        await fs.access(file);
    } catch (error) {
        if (error.code !== 'ENOENT') {
            throw error;
        }
        await saveJson(file, defaultValue);
    }
}

async function ensureDataFiles() {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await ensureJsonFile(AUTH_FILE, {
        username: 'admin',
        password: 'admin123'
    });
    await ensureJsonFile(ACCOUNTS_FILE, []);
    await ensureJsonFile(CERTIFICATES_FILE, []);
}

// 简单的文件锁机制，防止并发写入证书文件
let certWriteLock = Promise.resolve();

async function saveCertificatesWithLock(newCert) {
    // 使用 Promise 链确保顺序写入
    certWriteLock = certWriteLock.then(async () => {
        const certificates = await loadJson(CERTIFICATES_FILE);
        // 检查是否已存在（避免重复）
        const exists = certificates.some(c => c.id === newCert.id);
        if (!exists) {
            certificates.push(newCert);
            await saveJson(CERTIFICATES_FILE, certificates);
        }
        return certificates;
    }).catch(err => {
        console.error('[CERT] Lock write error:', err);
        throw err;
    });
    return certWriteLock;
}

async function fetchDnsRecordsPage(account, page = 1, perPage = 10) {
    const headers = {
        'Authorization': `Bearer ${account.token}`,
        'Content-Type': 'application/json'
    };
    const response = await cloudflareApi.get(
        `https://api.cloudflare.com/client/v4/zones/${account.zoneId}/dns_records`,
        {
            headers,
            params: {
                page,
                per_page: perPage
            }
        }
    );

    if (!response.data.success) {
        throw new Error(response.data.errors?.[0]?.message || '获取 DNS 记录失败');
    }

    return {
        records: response.data.result || [],
        pagination: {
            page: response.data.result_info?.page || page,
            perPage: response.data.result_info?.per_page || perPage,
            totalPages: response.data.result_info?.total_pages || 1,
            totalCount: response.data.result_info?.total_count || 0,
            count: response.data.result_info?.count || (response.data.result || []).length
        }
    };
}

// 认证中间件
function requireAuth(req, res, next) {
    if (req.session && req.session.authenticated) {
        return next();
    }
    res.status(401).json({ error: '未授权，请先登录' });
}

// === 认证路由 ===

app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        const auth = await loadJson(AUTH_FILE);

        if (auth && username === auth.username && password === auth.password) {
            req.session.authenticated = true;
            req.session.username = username;
            res.json({ success: true });
        } else {
            res.status(401).json({ error: '用户名或密码错误' });
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/logout', (req, res) => {
    req.session.destroy();
    res.json({ success: true });
});

app.get('/api/auth/check', (req, res) => {
    res.json({ authenticated: !!req.session?.authenticated });
});

// 修改账号信息（用户名和密码）
app.post('/api/auth/change-password', requireAuth, async (req, res) => {
    try {
        const { currentPassword, newPassword, newUsername } = req.body;

        if (!currentPassword) {
            return res.status(400).json({ error: '请输入当前密码' });
        }

        const auth = await loadJson(AUTH_FILE);

        // 验证当前密码
        if (currentPassword !== auth.password) {
            return res.status(400).json({ error: '当前密码错误' });
        }

        // 检查是否有修改
        if (!newPassword && !newUsername) {
            return res.status(400).json({ error: '请输入新用户名或新密码' });
        }

        // 更新信息
        if (newUsername && newUsername.trim()) {
            auth.username = newUsername.trim();
        }
        if (newPassword) {
            auth.password = newPassword;
        }
        await saveJson(AUTH_FILE, auth);

        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// === 账户/域名管理路由 ===

// 获取所有管理域名
app.get('/api/accounts', requireAuth, async (req, res) => {
    try {
        const accounts = await loadJson(ACCOUNTS_FILE);
        // 返回完整信息包括 token,用于编辑时显示
        res.json(accounts);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 添加新域名
app.post('/api/accounts', requireAuth, async (req, res) => {
    try {
        const { domain, token } = req.body;
        if (!domain || !token) {
            return res.status(400).json({ error: '域名和 Token 都是必填的' });
        }

        // 验证 Token 并获取 Zone ID
        const response = await cloudflareApi.get(
            `https://api.cloudflare.com/client/v4/zones?name=${domain}`,
            {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                }
            }
        );

        if (!response.data.success || response.data.result.length === 0) {
            return res.status(400).json({ error: '无法验证域名或 Token 无效' });
        }

        const zoneId = response.data.result[0].id;
        const accounts = await loadJson(ACCOUNTS_FILE);

        // 检查是否重复
        if (accounts.some(acc => acc.domain === domain)) {
            return res.status(400).json({ error: '该域名已存在' });
        }

        const newAccount = {
            id: uuidv4(),
            domain,
            token,
            zoneId,
            createdAt: new Date().toISOString()
        };

        accounts.push(newAccount);
        await saveJson(ACCOUNTS_FILE, accounts);

        res.json({ success: true, account: { id: newAccount.id, domain, zoneId } });
    } catch (error) {
        res.status(500).json({ error: error.response?.data?.errors?.[0]?.message || error.message });
    }
});

// 更新域名 API Token
app.put('/api/accounts/:id', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const { token } = req.body;

        if (!token) {
            return res.status(400).json({ error: 'Token 是必填的' });
        }

        let accounts = await loadJson(ACCOUNTS_FILE);
        const accountIndex = accounts.findIndex(acc => acc.id === id);

        if (accountIndex === -1) {
            return res.status(404).json({ error: '域名未找到' });
        }

        const account = accounts[accountIndex];

        // 验证新的 Token
        const response = await cloudflareApi.get(
            `https://api.cloudflare.com/client/v4/zones?name=${account.domain}`,
            {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                }
            }
        );

        if (!response.data.success || response.data.result.length === 0) {
            return res.status(400).json({ error: '无法验证 Token 或 Token 无效' });
        }

        // 更新 Token
        accounts[accountIndex].token = token;
        await saveJson(ACCOUNTS_FILE, accounts);

        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.response?.data?.errors?.[0]?.message || error.message });
    }
});

// 删除域名
app.delete('/api/accounts/:id', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;
        let accounts = await loadJson(ACCOUNTS_FILE);
        accounts = accounts.filter(acc => acc.id !== id);
        await saveJson(ACCOUNTS_FILE, accounts);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 重新排序域名
app.post('/api/accounts/reorder', requireAuth, async (req, res) => {
    try {
        const { order } = req.body;

        if (!order || !Array.isArray(order)) {
            return res.status(400).json({ error: '无效的排序数据' });
        }

        let accounts = await loadJson(ACCOUNTS_FILE);

        // Create a map of id to order
        const orderMap = {};
        order.forEach(item => {
            orderMap[item.id] = item.order;
        });

        // Update order property for each account
        accounts.forEach(acc => {
            if (orderMap[acc.id] !== undefined) {
                acc.order = orderMap[acc.id];
            }
        });

        // Sort accounts by order
        accounts.sort((a, b) => (a.order || 0) - (b.order || 0));

        await saveJson(ACCOUNTS_FILE, accounts);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// === DNS 记录管理路由 ===

// 获取指定账户的 DNS 记录
app.get('/api/dns/:accountId/records', requireAuth, async (req, res) => {
    try {
        const { accountId } = req.params;
        const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
        const requestedPerPage = parseInt(req.query.perPage || req.query.per_page, 10) || 10;
        const perPage = Math.min(Math.max(requestedPerPage, 1), 100);
        const accounts = await loadJson(ACCOUNTS_FILE);
        const account = accounts.find(acc => acc.id === accountId);

        if (!account) {
            return res.status(404).json({ error: '账户未找到' });
        }

        const result = await fetchDnsRecordsPage(account, page, perPage);
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.response?.data?.errors?.[0]?.message || error.message });
    }
});

// 创建 DNS 记录
app.post('/api/dns/:accountId/records', requireAuth, async (req, res) => {
    try {
        const { accountId } = req.params;
        const { type, name, content, ttl, proxied } = req.body;

        const accounts = await loadJson(ACCOUNTS_FILE);
        const account = accounts.find(acc => acc.id === accountId);

        if (!account) {
            return res.status(404).json({ error: '账户未找到' });
        }

        const response = await cloudflareApi.post(
            `https://api.cloudflare.com/client/v4/zones/${account.zoneId}/dns_records`,
            { type, name, content, ttl: ttl || 1, proxied: proxied || false },
            {
                headers: {
                    'Authorization': `Bearer ${account.token}`,
                    'Content-Type': 'application/json'
                }
            }
        );

        res.json(response.data.result);
    } catch (error) {
        res.status(500).json({ error: error.response?.data?.errors?.[0]?.message || error.message });
    }
});

// 更新 DNS 记录
app.put('/api/dns/:accountId/records/:id', requireAuth, async (req, res) => {
    try {
        const { accountId, id } = req.params;
        const { type, name, content, ttl, proxied } = req.body;

        const accounts = await loadJson(ACCOUNTS_FILE);
        const account = accounts.find(acc => acc.id === accountId);

        if (!account) {
            return res.status(404).json({ error: '账户未找到' });
        }

        const response = await cloudflareApi.put(
            `https://api.cloudflare.com/client/v4/zones/${account.zoneId}/dns_records/${id}`,
            { type, name, content, ttl: ttl || 1, proxied: proxied || false },
            {
                headers: {
                    'Authorization': `Bearer ${account.token}`,
                    'Content-Type': 'application/json'
                }
            }
        );

        res.json(response.data.result);
    } catch (error) {
        res.status(500).json({ error: error.response?.data?.errors?.[0]?.message || error.message });
    }
});

// 删除 DNS 记录
app.delete('/api/dns/:accountId/records/:id', requireAuth, async (req, res) => {
    console.log(`[DELETE] Request for account ${req.params.accountId}, record ${req.params.id}`);
    try {
        const { accountId, id } = req.params;
        const accounts = await loadJson(ACCOUNTS_FILE);
        const account = accounts.find(acc => acc.id === accountId);

        if (!account) {
            console.error('[DELETE] Account not found');
            return res.status(404).json({ error: '账户未找到' });
        }

        console.log(`[DELETE] Using Token: ${account.token.substring(0, 5)}... Zone: ${account.zoneId}`);

        await cloudflareApi.delete(
            `https://api.cloudflare.com/client/v4/zones/${account.zoneId}/dns_records/${id}`,
            {
                headers: {
                    'Authorization': `Bearer ${account.token}`,
                    'Content-Type': 'application/json'
                }
            }
        );

        console.log('[DELETE] Cloudflare success');
        res.json({ success: true });
    } catch (error) {
        console.error('[DELETE] Error:', error.response?.data || error.message);
        res.status(500).json({ error: error.response?.data?.errors?.[0]?.message || error.message });
    }
});

// === SSL 证书管理路由 ===

// 获取账户的所有证书（从 Cloudflare API + 本地私钥）
app.get('/api/dns/:accountId/certificates', requireAuth, async (req, res) => {
    try {
        const { accountId } = req.params;

        const accounts = await loadJson(ACCOUNTS_FILE);
        const account = accounts.find(acc => acc.id === accountId);

        if (!account) {
            return res.status(404).json({ error: '账户未找到' });
        }

        // 从 Cloudflare API 获取所有 Origin Certificates
        const response = await cloudflareApi.get(
            `https://api.cloudflare.com/client/v4/certificates?zone_id=${account.zoneId}`,
            {
                headers: {
                    'Authorization': `Bearer ${account.token}`,
                    'Content-Type': 'application/json'
                }
            }
        );

        if (!response.data.success) {
            throw new Error(response.data.errors?.[0]?.message || '获取证书列表失败');
        }

        const cloudflareCerts = response.data.result || [];

        // 从本地存储获取私钥（因为 Cloudflare 不返回私钥）
        const localCerts = await loadJson(CERTIFICATES_FILE);
        const accountLocalCerts = localCerts.filter(cert => cert.accountId === accountId);

        // 合并：用 Cloudflare 数据为主，补充本地私钥
        const mergedCerts = cloudflareCerts.map(cfCert => {
            const localCert = accountLocalCerts.find(lc => lc.id === cfCert.id);
            return {
                id: cfCert.id,
                accountId: accountId,
                hostname: cfCert.hostnames?.[0] || '',
                hostnames: cfCert.hostnames,
                certificate: cfCert.certificate,
                privateKey: localCert?.privateKey || null, // 本地私钥
                expiresOn: cfCert.expires_on,
                requestType: cfCert.request_type,
                fromCloudflare: true
            };
        });

        res.json(mergedCerts);
    } catch (error) {
        console.error('[CERT] List error:', error.response?.data || error.message);
        // 如果 Cloudflare API 失败，回退到本地存储
        try {
            const certificates = await loadJson(CERTIFICATES_FILE);
            const accountCerts = certificates.filter(cert => cert.accountId === accountId);
            res.json(accountCerts);
        } catch (fallbackError) {
            res.status(500).json({ error: error.response?.data?.errors?.[0]?.message || error.message });
        }
    }
});

// 获取指定主机名的证书（从 Cloudflare API）
app.get('/api/dns/:accountId/certificates/:hostname', requireAuth, async (req, res) => {
    try {
        const { accountId, hostname } = req.params;

        const accounts = await loadJson(ACCOUNTS_FILE);
        const account = accounts.find(acc => acc.id === accountId);

        if (!account) {
            return res.status(404).json({ error: '账户未找到' });
        }

        // 从 Cloudflare API 获取证书列表
        const response = await cloudflareApi.get(
            `https://api.cloudflare.com/client/v4/certificates?zone_id=${account.zoneId}`,
            {
                headers: {
                    'Authorization': `Bearer ${account.token}`,
                    'Content-Type': 'application/json'
                }
            }
        );

        if (!response.data.success) {
            throw new Error(response.data.errors?.[0]?.message || '获取证书列表失败');
        }

        const cloudflareCerts = response.data.result || [];

        // 查找匹配的证书（检查 hostnames 数组）
        const cfCert = cloudflareCerts.find(c =>
            c.hostnames && c.hostnames.includes(hostname)
        );

        if (!cfCert) {
            return res.json({ exists: false });
        }

        // 从本地获取私钥
        const localCerts = await loadJson(CERTIFICATES_FILE);
        const localCert = localCerts.find(lc => lc.id === cfCert.id);

        const cert = {
            id: cfCert.id,
            accountId: accountId,
            hostname: hostname,
            hostnames: cfCert.hostnames,
            certificate: cfCert.certificate,
            privateKey: localCert?.privateKey || null,
            expiresOn: cfCert.expires_on,
            requestType: cfCert.request_type,
            fromCloudflare: true
        };

        res.json({ exists: true, certificate: cert });
    } catch (error) {
        console.error('[CERT] Get error:', error.response?.data || error.message);
        // 回退到本地存储
        try {
            const certificates = await loadJson(CERTIFICATES_FILE);
            const cert = certificates.find(c => c.accountId === req.params.accountId && c.hostname === req.params.hostname);
            if (cert) {
                res.json({ exists: true, certificate: cert });
            } else {
                res.json({ exists: false });
            }
        } catch (fallbackError) {
            res.status(500).json({ error: error.message });
        }
    }
});

// 申请新证书
app.post('/api/dns/:accountId/certificates', requireAuth, async (req, res) => {
    try {
        const { accountId } = req.params;
        const { hostname } = req.body;

        if (!hostname) {
            return res.status(400).json({ error: '主机名是必填的' });
        }

        const accounts = await loadJson(ACCOUNTS_FILE);
        const account = accounts.find(acc => acc.id === accountId);

        if (!account) {
            return res.status(404).json({ error: '账户未找到' });
        }

        // 检查是否已存在该主机名的证书
        let certificates = await loadJson(CERTIFICATES_FILE);
        const existingCert = certificates.find(c => c.accountId === accountId && c.hostname === hostname);

        if (existingCert) {
            return res.status(400).json({ error: '该主机名已有证书，请先撤销旧证书' });
        }

        // 只申请用户选择的主机名，不自动添加泛域名
        const hostnames = [hostname];

        // 使用 node-forge 生成 RSA 密钥对和 CSR
        console.log('[CERT] Generating RSA key pair and CSR...');
        const keys = forge.pki.rsa.generateKeyPair(2048);

        const csr = forge.pki.createCertificationRequest();
        csr.publicKey = keys.publicKey;
        csr.setSubject([
            { name: 'commonName', value: hostname },
            { name: 'countryName', value: 'CN' },
            { name: 'organizationName', value: hostname }
        ]);

        // 添加 SAN 扩展
        const altNamesAttr = hostnames.map(name => ({ type: 2, value: name }));
        csr.setAttributes([{
            name: 'extensionRequest',
            extensions: [{
                name: 'subjectAltName',
                altNames: altNamesAttr
            }]
        }]);

        csr.sign(keys.privateKey, forge.md.sha256.create());

        const csrPem = forge.pki.certificationRequestToPem(csr);
        const privateKeyPem = forge.pki.privateKeyToPem(keys.privateKey);

        console.log('[CERT] CSR generated, calling Cloudflare API...');

        // 调用 Cloudflare API 申请 Origin Certificate
        const response = await cloudflareApi.post(
            'https://api.cloudflare.com/client/v4/certificates',
            {
                hostnames: hostnames,
                requested_validity: 5475, // 15年
                request_type: 'origin-rsa',
                csr: csrPem
            },
            {
                headers: {
                    'Authorization': `Bearer ${account.token}`,
                    'Content-Type': 'application/json'
                }
            }
        );

        if (!response.data.success) {
            const errorMsg = response.data.errors?.[0]?.message || '申请证书失败';
            return res.status(400).json({ error: errorMsg });
        }

        const certData = response.data.result;

        // 保存证书到本地（使用我们生成的私钥）
        const newCert = {
            id: certData.id,
            accountId: accountId,
            hostname: hostname,
            hostnames: certData.hostnames,
            certificate: certData.certificate,
            privateKey: privateKeyPem, // 使用我们生成的私钥
            expiresOn: certData.expires_on,
            requestType: certData.request_type,
            createdAt: new Date().toISOString()
        };

        // 使用锁机制保存证书（防止并发写入丢失数据）
        await saveCertificatesWithLock(newCert);

        console.log('[CERT] Certificate saved successfully');

        res.json({
            success: true,
            certificate: newCert
        });
    } catch (error) {
        console.error('[CERT] Apply error:', error.response?.data || error.message);
        res.status(500).json({ error: error.response?.data?.errors?.[0]?.message || error.message });
    }
});

// 撤销证书
app.delete('/api/dns/:accountId/certificates/:certId', requireAuth, async (req, res) => {
    try {
        const { accountId, certId } = req.params;

        const accounts = await loadJson(ACCOUNTS_FILE);
        const account = accounts.find(acc => acc.id === accountId);

        if (!account) {
            return res.status(404).json({ error: '账户未找到' });
        }

        // 调用 Cloudflare API 撤销证书
        await cloudflareApi.delete(
            `https://api.cloudflare.com/client/v4/certificates/${certId}`,
            {
                headers: {
                    'Authorization': `Bearer ${account.token}`,
                    'Content-Type': 'application/json'
                }
            }
        );

        // 从本地存储中删除
        let certificates = await loadJson(CERTIFICATES_FILE);
        certificates = certificates.filter(c => c.id !== certId);
        await saveJson(CERTIFICATES_FILE, certificates);

        res.json({ success: true });
    } catch (error) {
        console.error('[CERT] Revoke error:', error.response?.data || error.message);
        res.status(500).json({ error: error.response?.data?.errors?.[0]?.message || error.message });
    }
});

// 任何未匹配的路由都返回 index.html (如果已登录) 或 login.html
app.get('*', (req, res) => {
    if (req.url.startsWith('/api')) {
        return res.status(404).json({ error: 'Endpoint not found' });
    }

    if (req.session && req.session.authenticated) {
        res.sendFile(path.join(__dirname, 'public', 'index.html'));
    } else {
        res.sendFile(path.join(__dirname, 'public', 'login.html'));
    }
});

async function startServer() {
    await ensureDataFiles();
    app.listen(PORT, () => {
        console.log(`🚀 服务运行在 http://localhost:${PORT}`);
    });
}

startServer().catch(error => {
    console.error('❌ 服务启动失败:', error);
    process.exit(1);
});
