// State
let accounts = [];
let currentAccountId = null;
let currentRecords = [];
let currentRecordPage = 1;
let recordPagination = { page: 1, perPage: 10, totalPages: 1, totalCount: 0, count: 0 };
let selectedRecords = new Set(); // 多选的记录ID集合
let pendingDeleteRecordId = null; // 待删除的记录ID
let pendingDeleteDomainId = null; // 待删除的域名ID
let pendingBatchDelete = false; // 是否是批量删除
const RECORDS_PER_PAGE = 10;

// DOM Elements
const domainListContainer = document.getElementById('domainListContainer');
const welcomeState = document.getElementById('welcomeState');
const dnsManager = document.getElementById('dnsManager');
const currentDomainTitle = document.getElementById('currentDomainTitle');
const dnsTableBody = document.getElementById('dnsTableBody');
const recordsLoading = document.getElementById('recordsLoading');
const recordsPagination = document.getElementById('recordsPagination');
const pageNumberInput = document.getElementById('pageNumberInput');
const paginationMeta = document.getElementById('paginationMeta');
const prevPageBtn = document.getElementById('prevPageBtn');
const nextPageBtn = document.getElementById('nextPageBtn');
const logoutBtn = document.getElementById('logoutBtn');

// Modals
const addDomainModal = document.getElementById('addDomainModal');
const editDomainModal = document.getElementById('editDomainModal');
const recordModal = document.getElementById('recordModal');
const confirmDeleteModal = document.getElementById('confirmDeleteModal');
const batchEditModal = document.getElementById('batchEditModal');
const certModal = document.getElementById('certModal');

// Certificate state
let currentCertHostname = null;
let currentCertData = null;

// Initialization
document.addEventListener('DOMContentLoaded', () => {
    checkAuth();
    loadAccounts();
    setupEventListeners();
});

// Auth Check
async function checkAuth() {
    const res = await fetch('/api/auth/check');
    const data = await res.json();
    if (!data.authenticated) window.location.href = '/login.html';
}

// Event Listeners
function setupEventListeners() {
    logoutBtn.addEventListener('click', async () => {
        await fetch('/api/logout', { method: 'POST' });
        window.location.href = '/login.html';
    });

    // Modal Triggers
    document.getElementById('addDomainBtn').onclick = () => openModal(addDomainModal);
    document.getElementById('addRecordBtn').onclick = () => openRecordModal();
    document.getElementById('accountManageBtn').onclick = () => {
        document.getElementById('changePasswordForm').reset();
        document.getElementById('changePasswordError').textContent = '';
        document.getElementById('changePasswordSuccess').style.display = 'none';
        openModal(document.getElementById('accountManageModal'));
    };

    // Close Modals
    document.querySelectorAll('.close-modal').forEach(btn => {
        btn.onclick = (e) => {
            e.preventDefault();
            closeAllModals();
        }
    });

    // Mobile Menu Toggle
    const mobileMenuToggle = document.getElementById('mobileMenuToggle');
    const sidebar = document.getElementById('sidebar');
    const mobileOverlay = document.getElementById('mobileOverlay');

    if (mobileMenuToggle) {
        mobileMenuToggle.addEventListener('click', () => {
            sidebar.classList.toggle('mobile-open');
            mobileOverlay.classList.toggle('active');
        });
    }

    if (mobileOverlay) {
        mobileOverlay.addEventListener('click', () => {
            sidebar.classList.remove('mobile-open');
            mobileOverlay.classList.remove('active');
        });
    }

    // Setup Forms
    document.getElementById('addDomainForm').onsubmit = handleAddDomain;
    document.getElementById('editDomainForm').onsubmit = handleEditDomain;
    document.getElementById('recordForm').onsubmit = handleSaveRecord;
    document.getElementById('changePasswordForm').onsubmit = handleChangePassword;

    // Confirm Delete Button
    document.getElementById('confirmDeleteBtn').onclick = executeDelete;

    // Batch Edit/Delete Buttons
    document.getElementById('batchEditBtn').onclick = openBatchEditModal;
    document.getElementById('batchDeleteBtn').onclick = confirmBatchDelete;

    // Select All Checkbox
    document.getElementById('selectAllRecords').onchange = handleSelectAll;
    prevPageBtn.onclick = () => {
        if (currentAccountId && currentRecordPage > 1) {
            loadRecords(currentAccountId, currentRecordPage - 1);
        }
    };
    nextPageBtn.onclick = () => {
        if (currentAccountId && currentRecordPage < recordPagination.totalPages) {
            loadRecords(currentAccountId, currentRecordPage + 1);
        }
    };
    pageNumberInput.onchange = handlePageNumberChange;
    pageNumberInput.onblur = handlePageNumberChange;
    pageNumberInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            handlePageNumberChange();
        }
    });

    // Batch Edit Form
    document.getElementById('batchEditForm').onsubmit = handleBatchEdit;

    // Batch Edit Checkboxes - enable/disable corresponding inputs
    document.getElementById('batchEditProxied').onchange = (e) => {
        document.getElementById('batchRecordProxied').disabled = !e.target.checked;
    };
}

// --- Domain Management ---

async function loadAccounts() {
    try {
        const res = await fetch('/api/accounts');
        if (res.status === 401) return window.location.href = '/login.html';

        accounts = await res.json();
        renderDomainList();
    } catch (err) {
        console.error(err);
    }
}

function renderDomainList() {
    if (accounts.length === 0) {
        domainListContainer.innerHTML = '<div class="empty-state" style="padding:1rem; font-size:0.8rem;">暂无域名，请添加</div>';
        return;
    }

    domainListContainer.innerHTML = accounts.map((acc, index) => `
        <div class="domain-item ${currentAccountId === acc.id ? 'active' : ''}" 
             data-index="${index}"
             data-id="${acc.id}"
             onclick="selectDomain('${acc.id}')">
            <span class="drag-handle" 
                  draggable="true"
                  ondragstart="handleDragStart(event)"
                  ondragover="handleDragOver(event)"
                  ondrop="handleDrop(event)"
                  ondragend="handleDragEnd(event)"
                  onclick="event.stopPropagation()"
                  title="拖动排序">☰</span>
            <span class="domain-name">${acc.domain}</span>
            <div class="domain-actions">
                <span class="edit-icon" onclick="editDomain(event, '${acc.id}')" title="编辑">编辑</span>
                <span class="delete-icon" onclick="deleteDomain(event, '${acc.id}')" title="删除">删除</span>
            </div>
        </div>
    `).join('');
}

async function handleAddDomain(e) {
    e.preventDefault();
    const domainInput = document.getElementById('newDomainName').value.trim();
    const token = document.getElementById('newDomainToken').value;
    const errorEl = document.getElementById('addDomainError');
    const btn = e.target.querySelector('button[type="submit"]');

    // 支持逗号分隔的多个域名
    const domains = domainInput.split(/[,，]/).map(d => d.trim()).filter(d => d);

    if (domains.length === 0) {
        errorEl.textContent = '请输入域名';
        return;
    }

    btn.disabled = true;
    errorEl.textContent = '';

    let successCount = 0;
    let failedDomains = [];

    for (let i = 0; i < domains.length; i++) {
        const domain = domains[i];
        btn.textContent = `验证中... (${i + 1}/${domains.length})`;

        try {
            const res = await fetch('/api/accounts', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ domain, token })
            });
            const data = await res.json();

            if (data.success) {
                successCount++;
            } else {
                failedDomains.push(`${domain}: ${data.error}`);
            }
        } catch (err) {
            failedDomains.push(`${domain}: 请求失败`);
        }
    }

    btn.disabled = false;
    btn.textContent = '验证并添加';

    if (failedDomains.length === 0) {
        closeAllModals();
        e.target.reset();
        loadAccounts();
        if (successCount > 1) {
            showCopyToast(`成功添加 ${successCount} 个域名`);
        }
    } else if (successCount > 0) {
        loadAccounts();
        errorEl.textContent = `成功 ${successCount} 个，失败 ${failedDomains.length} 个: ${failedDomains[0]}`;
    } else {
        errorEl.textContent = failedDomains[0];
    }
}

function editDomain(e, id) {
    e.stopPropagation();

    // Find the domain data
    const domain = accounts.find(acc => acc.id === id);
    if (!domain) return;

    // Populate the form
    document.getElementById('editDomainId').value = id;
    document.getElementById('editDomainName').value = domain.domain;
    document.getElementById('editDomainToken').value = domain.token || '';
    document.getElementById('editDomainError').textContent = '';

    // Open the modal
    openModal(editDomainModal);
}

async function handleEditDomain(e) {
    e.preventDefault();
    const id = document.getElementById('editDomainId').value;
    const token = document.getElementById('editDomainToken').value;
    const errorEl = document.getElementById('editDomainError');
    const btn = e.target.querySelector('button[type="submit"]');

    btn.disabled = true;
    btn.textContent = '保存中...';
    errorEl.textContent = '';

    try {
        const res = await fetch(`/api/accounts/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token })
        });
        const data = await res.json();

        if (data.success) {
            closeAllModals();
            loadAccounts();
        } else {
            errorEl.textContent = data.error;
        }
    } catch (err) {
        errorEl.textContent = '请求失败';
    } finally {
        btn.disabled = false;
        btn.textContent = '保存修改';
    }
}

async function handleChangePassword(e) {
    e.preventDefault();

    const newUsername = document.getElementById('newUsername').value.trim();
    const currentPassword = document.getElementById('currentPassword').value;
    const newPassword = document.getElementById('newPassword').value;
    const confirmPassword = document.getElementById('confirmPassword').value;
    const errorEl = document.getElementById('changePasswordError');
    const successEl = document.getElementById('changePasswordSuccess');
    const btn = e.target.querySelector('button[type="submit"]');

    errorEl.textContent = '';
    successEl.style.display = 'none';

    // 验证至少有一个修改
    if (!newUsername && !newPassword) {
        errorEl.textContent = '请输入新用户名或新密码';
        return;
    }

    // 验证新密码一致
    if (newPassword && newPassword !== confirmPassword) {
        errorEl.textContent = '两次输入的新密码不一致';
        return;
    }

    if (newPassword && newPassword.length < 4) {
        errorEl.textContent = '新密码至少4个字符';
        return;
    }

    btn.disabled = true;
    btn.textContent = '保存中...';

    try {
        const res = await fetch('/api/auth/change-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ currentPassword, newPassword, newUsername })
        });
        const data = await res.json();

        if (data.success) {
            successEl.textContent = '修改成功！';
            successEl.style.display = 'block';
            e.target.reset();
            setTimeout(() => {
                closeAllModals();
            }, 1500);
        } else {
            errorEl.textContent = data.error || '修改失败';
        }
    } catch (err) {
        errorEl.textContent = '请求失败';
    } finally {
        btn.disabled = false;
        btn.textContent = '保存修改';
    }
}

function deleteDomain(e, id) {
    e.stopPropagation();

    // 保存待删除的域名ID并打开确认模态框
    pendingDeleteDomainId = id;
    openModal(confirmDeleteModal);
}

async function executeDomainDelete() {
    if (!pendingDeleteDomainId) return;

    const id = pendingDeleteDomainId;
    closeAllModals();
    pendingDeleteDomainId = null;

    try {
        const res = await fetch(`/api/accounts/${id}`, { method: 'DELETE' });
        const data = await res.json();

        if (res.ok && data.success) {
            if (currentAccountId === id) {
                currentAccountId = null;
                welcomeState.style.display = 'block';
                dnsManager.style.display = 'none';
            }
            loadAccounts();
        } else {
            alert('删除失败: ' + (data.error || '未知错误'));
        }
    } catch (err) {
        console.error(err);
        alert('删除请求失败');
    }
}

function selectDomain(id) {
    currentAccountId = id;
    currentRecordPage = 1;
    const account = accounts.find(a => a.id === id);
    if (!account) return;

    currentDomainTitle.textContent = account.domain;
    renderDomainList(); // Update active state

    welcomeState.style.display = 'none';
    dnsManager.style.display = 'flex';
    loadRecords(id, 1);

    // Close mobile menu after selection
    const sidebar = document.getElementById('sidebar');
    const mobileOverlay = document.getElementById('mobileOverlay');
    if (sidebar) sidebar.classList.remove('mobile-open');
    if (mobileOverlay) mobileOverlay.classList.remove('active');
}

// --- DNS Management ---

async function loadRecords(accountId, page = 1) {
    dnsTableBody.innerHTML = '';
    recordsLoading.style.display = 'flex';
    recordsPagination.style.display = 'none';

    try {
        const query = new URLSearchParams({
            page: String(page),
            perPage: String(RECORDS_PER_PAGE)
        });

        // 同时获取 DNS 记录和证书列表
        const [recordsRes, certsRes] = await Promise.all([
            fetch(`/api/dns/${accountId}/records?${query.toString()}`),
            fetch(`/api/dns/${accountId}/certificates`)
        ]);
        const recordsData = await recordsRes.json();
        const certs = await certsRes.json();

        if (!recordsRes.ok) {
            throw new Error(recordsData.error || 'DNS 记录加载失败');
        }

        if (!certsRes.ok) {
            throw new Error(certs.error || '证书列表加载失败');
        }

        let records;
        if (Array.isArray(recordsData)) {
            const totalCount = recordsData.length;
            const totalPages = Math.max(Math.ceil(totalCount / RECORDS_PER_PAGE), 1);
            const safePage = Math.min(page, totalPages);

            if (safePage !== page) {
                return loadRecords(accountId, safePage);
            }

            const startIndex = (safePage - 1) * RECORDS_PER_PAGE;
            records = recordsData.slice(startIndex, startIndex + RECORDS_PER_PAGE);
            recordPagination = {
                page: safePage,
                perPage: RECORDS_PER_PAGE,
                totalPages,
                totalCount,
                count: records.length
            };
        } else {
            records = recordsData.records || [];
            recordPagination = recordsData.pagination || {
                page,
                perPage: RECORDS_PER_PAGE,
                totalPages: 1,
                totalCount: records.length,
                count: records.length
            };

            if (recordPagination.totalPages > 0 && page > recordPagination.totalPages) {
                return loadRecords(accountId, recordPagination.totalPages);
            }
        }

        // 获取已有证书的域名列表
        const certHostnames = new Set();
        const certList = Array.isArray(certs) ? certs : (certs.certificates || []);
        certList.forEach(cert => {
            if (cert.hostnames) {
                cert.hostnames.forEach(h => certHostnames.add(h));
            }
            if (cert.hostname) {
                certHostnames.add(cert.hostname);
            }
        });

        currentRecordPage = recordPagination.page || page;
        currentRecords = records;
        renderRecords(records, certHostnames);
        renderPagination();
    } catch (err) {
        currentRecords = [];
        currentRecordPage = 1;
        recordPagination = { page: 1, perPage: RECORDS_PER_PAGE, totalPages: 1, totalCount: 0, count: 0 };
        dnsTableBody.innerHTML = `<tr><td colspan="6" class="text-center" style="color:var(--danger)">加载失败</td></tr>`;
        renderPagination();
    } finally {
        recordsLoading.style.display = 'none';
    }
}

function renderPagination() {
    if (recordPagination.totalCount === 0) {
        recordsPagination.style.display = 'none';
        pageNumberInput.value = '';
        pageNumberInput.disabled = true;
        paginationMeta.textContent = '';
        prevPageBtn.disabled = true;
        nextPageBtn.disabled = true;
        return;
    }

    const totalPages = Math.max(recordPagination.totalPages || 1, 1);
    const currentPage = Math.min(recordPagination.page || 1, totalPages);

    pageNumberInput.disabled = totalPages <= 1;
    pageNumberInput.min = '1';
    pageNumberInput.max = String(totalPages);
    pageNumberInput.value = String(currentPage);
    paginationMeta.textContent = `/ ${totalPages} 页，共 ${recordPagination.totalCount} 条`;
    prevPageBtn.disabled = currentPage <= 1;
    nextPageBtn.disabled = currentPage >= totalPages;
    recordsPagination.style.display = 'flex';
}

function handlePageNumberChange() {
    if (!currentAccountId) return;

    const totalPages = Math.max(recordPagination.totalPages || 1, 1);
    const rawPage = parseInt(pageNumberInput.value, 10);

    if (!Number.isFinite(rawPage)) {
        pageNumberInput.value = String(currentRecordPage);
        return;
    }

    const targetPage = Math.min(Math.max(rawPage, 1), totalPages);
    pageNumberInput.value = String(targetPage);

    if (targetPage !== currentRecordPage) {
        loadRecords(currentAccountId, targetPage);
    }
}

function renderRecords(records, certHostnames = new Set()) {
    // 清空选中状态
    selectedRecords.clear();
    updateBatchButtons();
    document.getElementById('selectAllRecords').checked = false;

    if (records.length === 0) {
        dnsTableBody.innerHTML = `<tr><td colspan="6" class="text-center" style="color:var(--text-muted)">暂无记录</td></tr>`;
        return;
    }

    dnsTableBody.innerHTML = records.map(rec => {
        const hasCert = certHostnames.has(rec.name);
        const sslBtnColor = hasCert ? '#f59e0b' : '#22c55e'; // 橙色表示已有证书，绿色表示未申请

        return `
        <tr>
            <td data-label="选择">
                <input type="checkbox" class="record-checkbox" data-id="${rec.id}" onchange="handleRecordSelect('${rec.id}', this.checked)">
            </td>
            <td data-label="类型"><span class="badge badge-gray">${rec.type}</span></td>
            <td data-label="名称">${rec.name}</td>
            <td data-label="内容" style="max-width: 200px; overflow: hidden; text-overflow: ellipsis;">${rec.content}</td>
            <td data-label="代理状态">
                ${rec.proxied
                ? '<span class="badge badge-orange">已代理</span>'
                : '<span class="badge badge-gray">仅 DNS</span>'}
            </td>
            <td data-label="操作">
                <div class="record-actions">
                    <button class="btn btn-outline btn-sm" style="color:${sslBtnColor}; border-color:${sslBtnColor}" onclick="openCertModal('${rec.name}')">SSL</button>
                    <button class="btn btn-outline btn-sm" style="color:#3b82f6; border-color:#3b82f6" onclick="openRecordModal('${rec.id}')">编辑</button>
                    <button class="btn btn-outline btn-sm" style="color:var(--danger); border-color:var(--danger)" onclick="deleteRecord('${rec.id}')">删除</button>
                </div>
            </td>
        </tr>
    `}).join('');
}

// Record Modal & CRUD

function openRecordModal(recordId = null) {
    const form = document.getElementById('recordForm');
    const title = document.getElementById('recordModalTitle');

    if (recordId) {
        const rec = currentRecords.find(r => r.id === recordId);
        title.textContent = '编辑 DNS 记录';
        document.getElementById('recordId').value = rec.id;
        document.getElementById('recordType').value = rec.type;
        document.getElementById('recordName').value = rec.name;
        document.getElementById('recordContent').value = rec.content;
        document.getElementById('recordProxied').value = rec.proxied.toString();
    } else {
        title.textContent = '添加 DNS 记录';
        form.reset();
        document.getElementById('recordId').value = '';
        document.getElementById('recordProxied').value = 'false';
    }

    openModal(recordModal);
}

async function handleSaveRecord(e) {
    e.preventDefault();
    if (!currentAccountId) return;

    const id = document.getElementById('recordId').value;
    const data = {
        type: document.getElementById('recordType').value,
        name: document.getElementById('recordName').value,
        content: document.getElementById('recordContent').value,
        proxied: document.getElementById('recordProxied').value === 'true',
        ttl: 1 // Auto
    };

    const url = id
        ? `/api/dns/${currentAccountId}/records/${id}`
        : `/api/dns/${currentAccountId}/records`;

    const method = id ? 'PUT' : 'POST';

    const btn = e.target.querySelector('button[type="submit"]');
    const errorEl = document.getElementById('recordError');

    btn.disabled = true;
    errorEl.textContent = '';

    try {
        const res = await fetch(url, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        const result = await res.json();

        if (result.error) {
            errorEl.textContent = result.error;
        } else {
            closeAllModals();
            loadRecords(currentAccountId, currentRecordPage);
        }
    } catch (err) {
        errorEl.textContent = '操作失败';
    } finally {
        btn.disabled = false;
    }
}

function deleteRecord(id) {
    console.log('[deleteRecord] Called with ID:', id);
    console.log('[deleteRecord] Current account ID:', currentAccountId);

    // Store the record ID to delete and open the confirmation modal
    pendingDeleteRecordId = id;
    openModal(confirmDeleteModal);
}

async function executeDelete() {
    // Check if we're deleting a DNS record or a domain
    if (pendingDeleteRecordId) {
        await executeRecordDelete();
    } else if (pendingDeleteDomainId) {
        await executeDomainDelete();
    }
}

async function executeRecordDelete() {
    if (!pendingDeleteRecordId) {
        console.log('[executeRecordDelete] No pending delete ID');
        return;
    }

    const id = pendingDeleteRecordId;
    console.log('[executeRecordDelete] Deleting record ID:', id);
    console.log('[executeRecordDelete] Current account ID:', currentAccountId);

    // Close the modal first
    closeAllModals();
    pendingDeleteRecordId = null;

    console.log('[executeRecordDelete] Sending DELETE request...');
    try {
        const url = `/api/dns/${currentAccountId}/records/${id}`;
        console.log('[executeRecordDelete] URL:', url);

        const res = await fetch(url, { method: 'DELETE' });
        console.log('[executeRecordDelete] Response status:', res.status);

        const data = await res.json();
        console.log('[executeRecordDelete] Response data:', data);

        if (res.ok && data.success) {
            console.log('[executeRecordDelete] Delete successful, updating UI');
            await loadRecords(currentAccountId, currentRecordPage);
        } else {
            console.error('[executeRecordDelete] Delete failed:', data);
            alert('删除失败: ' + (data.error || '未知错误'));
        }
    } catch (err) {
        console.error('[executeRecordDelete] Exception:', err);
        alert('删除请求失败');
    }
}


// Helpers
function openModal(modal) {
    modal.style.display = 'block';
}

function closeAllModals() {
    addDomainModal.style.display = 'none';
    editDomainModal.style.display = 'none';
    recordModal.style.display = 'none';
    confirmDeleteModal.style.display = 'none';
    batchEditModal.style.display = 'none';
    certModal.style.display = 'none';
    document.getElementById('accountManageModal').style.display = 'none';
    pendingDeleteRecordId = null; // 清除待删除ID
    pendingBatchDelete = false; // 清除批量删除标志
    currentCertHostname = null; // 清除证书主机名
    currentCertData = null; // 清除证书数据
}

// Drag and Drop Handlers
let draggedElement = null;
let draggedIndex = null;

function handleDragStart(e) {
    // Get the parent domain-item element
    draggedElement = e.currentTarget.closest('.domain-item');
    draggedIndex = parseInt(draggedElement.dataset.index);
    draggedElement.classList.add('dragging');

    // Set the drag image to the entire domain item
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setDragImage(draggedElement, 20, 20);
}

function handleDragOver(e) {
    if (e.preventDefault) {
        e.preventDefault();
    }
    e.dataTransfer.dropEffect = 'move';

    // Get the parent domain-item element
    const targetElement = e.currentTarget.closest('.domain-item');
    if (targetElement && targetElement !== draggedElement) {
        targetElement.style.borderTop = '2px solid var(--cf-yellow)';
    }
    return false;
}

function handleDrop(e) {
    if (e.stopPropagation) {
        e.stopPropagation();
    }

    // Get the parent domain-item element
    const targetElement = e.currentTarget.closest('.domain-item');
    if (!targetElement) return false;

    const targetIndex = parseInt(targetElement.dataset.index);

    if (draggedIndex !== targetIndex) {
        // Reorder the accounts array
        const draggedItem = accounts[draggedIndex];
        accounts.splice(draggedIndex, 1);
        accounts.splice(targetIndex, 0, draggedItem);

        // Save the new order to server
        saveAccountsOrder();

        // Re-render the list
        renderDomainList();
    }

    targetElement.style.borderTop = '';
    return false;
}

function handleDragEnd(e) {
    const draggedItem = e.currentTarget.closest('.domain-item');
    if (draggedItem) {
        draggedItem.classList.remove('dragging');
    }

    // Remove all border highlights
    document.querySelectorAll('.domain-item').forEach(item => {
        item.style.borderTop = '';
    });
}

async function saveAccountsOrder() {
    try {
        const orderData = accounts.map((acc, index) => ({
            id: acc.id,
            order: index
        }));

        await fetch('/api/accounts/reorder', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ order: orderData })
        });
    } catch (err) {
        console.error('Failed to save order:', err);
    }
}

// Ensure functions are global for HTML onclick attributes
window.selectDomain = selectDomain;
window.deleteDomain = deleteDomain;
window.editDomain = editDomain;
window.openRecordModal = openRecordModal;
window.deleteRecord = deleteRecord;
window.closeAllModals = closeAllModals;
window.handleDragStart = handleDragStart;
window.handleDragOver = handleDragOver;
window.handleDrop = handleDrop;
window.handleDragEnd = handleDragEnd;
window.handleRecordSelect = handleRecordSelect;

// --- 多选批量操作功能 ---

// 处理单个记录的选择
function handleRecordSelect(recordId, isChecked) {
    if (isChecked) {
        selectedRecords.add(recordId);
    } else {
        selectedRecords.delete(recordId);
    }
    updateBatchButtons();
    updateSelectAllCheckbox();
}

// 处理全选/取消全选
function handleSelectAll(e) {
    const isChecked = e.target.checked;
    const checkboxes = document.querySelectorAll('.record-checkbox');

    checkboxes.forEach(cb => {
        cb.checked = isChecked;
        const recordId = cb.dataset.id;
        if (isChecked) {
            selectedRecords.add(recordId);
        } else {
            selectedRecords.delete(recordId);
        }
    });

    updateBatchButtons();
}

// 更新全选复选框状态
function updateSelectAllCheckbox() {
    const checkboxes = document.querySelectorAll('.record-checkbox');
    const selectAllCheckbox = document.getElementById('selectAllRecords');

    if (checkboxes.length === 0) {
        selectAllCheckbox.checked = false;
        selectAllCheckbox.indeterminate = false;
        return;
    }

    const checkedCount = selectedRecords.size;
    if (checkedCount === 0) {
        selectAllCheckbox.checked = false;
        selectAllCheckbox.indeterminate = false;
    } else if (checkedCount === checkboxes.length) {
        selectAllCheckbox.checked = true;
        selectAllCheckbox.indeterminate = false;
    } else {
        selectAllCheckbox.checked = false;
        selectAllCheckbox.indeterminate = true;
    }
}

// 更新批量操作按钮的显示状态
function updateBatchButtons() {
    const batchEditBtn = document.getElementById('batchEditBtn');
    const batchDeleteBtn = document.getElementById('batchDeleteBtn');
    const batchSSLBtn = document.getElementById('batchSSLBtn');
    const hasSelection = selectedRecords.size > 0;

    batchEditBtn.style.display = hasSelection ? 'inline-block' : 'none';
    batchDeleteBtn.style.display = hasSelection ? 'inline-block' : 'none';
    batchSSLBtn.style.display = hasSelection ? 'inline-block' : 'none';

    const batchRevokeSSLBtn = document.getElementById('batchRevokeSSLBtn');
    batchRevokeSSLBtn.style.display = hasSelection ? 'inline-block' : 'none';

    if (hasSelection) {
        batchEditBtn.textContent = `批量修改 (${selectedRecords.size})`;
        batchDeleteBtn.textContent = `批量删除 (${selectedRecords.size})`;
        batchSSLBtn.textContent = `批量申请SSL (${selectedRecords.size})`;
        batchRevokeSSLBtn.textContent = `批量撤销SSL (${selectedRecords.size})`;
    }
}

// 打开批量编辑模态框
function openBatchEditModal() {
    if (selectedRecords.size === 0) return;

    // 重置表单
    document.getElementById('batchRecordType').value = 'A';
    document.getElementById('batchRecordContent').value = '';
    document.getElementById('batchEditProxied').checked = false;
    document.getElementById('batchRecordProxied').disabled = true;
    document.getElementById('batchEditError').textContent = '';
    document.getElementById('batchEditProgress').style.display = 'none';
    document.getElementById('batchSelectedCount').textContent = selectedRecords.size;

    openModal(batchEditModal);
}

// 确认批量删除
function confirmBatchDelete() {
    if (selectedRecords.size === 0) return;

    pendingBatchDelete = true;
    document.getElementById('confirmDeleteTitle').textContent = '确认批量删除';
    document.getElementById('confirmDeleteMessage').textContent =
        `确定要删除选中的 ${selectedRecords.size} 条 DNS 记录吗？此操作无法撤销。`;

    openModal(confirmDeleteModal);
}

// 处理批量编辑提交
async function handleBatchEdit(e) {
    e.preventDefault();

    const newType = document.getElementById('batchRecordType').value; // 类型始终有值（默认A）
    const newContent = document.getElementById('batchRecordContent').value.trim(); // 空则不修改类型和内容
    const editProxied = document.getElementById('batchEditProxied').checked;
    const newProxied = document.getElementById('batchRecordProxied').value === 'true';

    // 检查是否有任何修改：内容填写了 或者 勾选了修改代理状态
    if (!newContent && !editProxied) {
        document.getElementById('batchEditError').textContent = '请填写内容，或勾选修改代理状态';
        return;
    }

    const btn = e.target.querySelector('button[type="submit"]');
    btn.disabled = true;
    document.getElementById('batchEditError').textContent = '';
    document.getElementById('batchEditProgress').style.display = 'block';

    const recordIds = Array.from(selectedRecords);
    const total = recordIds.length;
    let completed = 0;

    // 更新进度显示
    const updateProgress = () => {
        const percent = Math.round((completed / total) * 100);
        document.getElementById('batchProgressBar').style.width = `${percent}%`;
        document.getElementById('batchProgressText').textContent = `${completed} / ${total}`;
        btn.textContent = `处理中... (${completed}/${total})`;
    };

    updateProgress();

    // 并发执行所有请求，每完成一个更新进度
    const promises = recordIds.map(async recordId => {
        const record = currentRecords.find(r => r.id === recordId);
        if (!record) {
            completed++;
            updateProgress();
            return { success: false };
        }

        const updateData = {
            type: newContent ? newType : record.type,
            name: record.name,
            content: newContent || record.content,
            proxied: editProxied ? newProxied : record.proxied,
            ttl: 1
        };

        try {
            const res = await fetch(`/api/dns/${currentAccountId}/records/${recordId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(updateData)
            });
            completed++;
            updateProgress();
            return { success: res.ok };
        } catch (err) {
            completed++;
            updateProgress();
            return { success: false };
        }
    });

    const results = await Promise.all(promises);
    const successCount = results.filter(r => r.success).length;
    const failCount = results.filter(r => !r.success).length;

    btn.disabled = false;
    btn.textContent = '应用修改';

    if (failCount === 0) {
        closeAllModals();
        loadRecords(currentAccountId, currentRecordPage);
    } else {
        document.getElementById('batchEditError').textContent =
            `完成: ${successCount} 成功, ${failCount} 失败`;
        setTimeout(() => {
            closeAllModals();
            loadRecords(currentAccountId, currentRecordPage);
        }, 2000);
    }
}

// 执行批量删除
async function executeBatchDelete() {
    const recordIds = Array.from(selectedRecords);

    // 并发执行所有删除请求
    const promises = recordIds.map(recordId =>
        fetch(`/api/dns/${currentAccountId}/records/${recordId}`, {
            method: 'DELETE'
        })
            .then(res => res.json().then(data => ({ success: res.ok && data.success, recordId })))
            .catch(() => ({ success: false, recordId }))
    );

    const results = await Promise.all(promises);
    const successCount = results.filter(r => r.success).length;
    const failCount = results.filter(r => !r.success).length;

    if (failCount > 0) {
        alert(`删除完成: ${successCount} 成功, ${failCount} 失败`);
    }

    // 清空选中状态并刷新
    selectedRecords.clear();
    await loadRecords(currentAccountId, currentRecordPage);
}

// 修改 executeDelete 函数以支持批量删除
const originalExecuteDelete = executeDelete;
window.executeDelete = async function () {
    if (pendingBatchDelete) {
        closeAllModals();
        pendingBatchDelete = false;
        // 重置确认模态框文本
        document.getElementById('confirmDeleteTitle').textContent = '确认删除';
        document.getElementById('confirmDeleteMessage').textContent = '确定要删除这条DNS记录吗?此操作无法撤销。';
        await executeBatchDelete();
    } else {
        await originalExecuteDelete();
    }
};

// 重新绑定确认删除按钮
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('confirmDeleteBtn').onclick = window.executeDelete;
});

// === SSL 证书管理功能 ===

// 打开证书模态框
async function openCertModal(hostname) {
    currentCertHostname = hostname;
    currentCertData = null;

    // 显示加载状态
    document.getElementById('certNotApplied').style.display = 'none';
    document.getElementById('certApplied').style.display = 'none';
    document.getElementById('certLoading').style.display = 'block';
    document.getElementById('certError').textContent = '';
    document.getElementById('certModalTitle').textContent = `SSL 证书 - ${hostname}`;

    openModal(certModal);

    try {
        // 检查是否已有证书
        const res = await fetch(`/api/dns/${currentAccountId}/certificates/${encodeURIComponent(hostname)}`);
        const data = await res.json();

        document.getElementById('certLoading').style.display = 'none';

        if (data.exists && data.certificate) {
            currentCertData = data.certificate;
            showCertApplied(data.certificate);
        } else {
            showCertNotApplied();
        }
    } catch (error) {
        document.getElementById('certLoading').style.display = 'none';
        document.getElementById('certError').textContent = '加载证书信息失败: ' + error.message;
        showCertNotApplied();
    }
}

// 显示未申请状态
function showCertNotApplied() {
    document.getElementById('certNotApplied').style.display = 'block';
    document.getElementById('certApplied').style.display = 'none';
    document.getElementById('revokeCertBtn').style.display = 'none'; // 隐藏撤销按钮

    // 绑定申请按钮事件
    document.getElementById('applyCertBtn').onclick = applyCertificate;
}

// 显示已申请状态
function showCertApplied(cert) {
    document.getElementById('certNotApplied').style.display = 'none';
    document.getElementById('certApplied').style.display = 'block';

    // 显示撤销按钮
    const revokeBtn = document.getElementById('revokeCertBtn');
    revokeBtn.style.display = 'inline-block';
    revokeBtn.onclick = () => revokeCertificate(cert.id);

    // 填充证书信息（去掉换行符让内容填满宽度）
    document.getElementById('certExpiresOn').textContent = cert.expiresOn ? new Date(cert.expiresOn).toLocaleDateString('zh-CN') : '-';
    document.getElementById('certHostnames').textContent = cert.hostnames ? cert.hostnames.join(', ') : cert.hostname;
    document.getElementById('certPemContent').value = (cert.certificate || '').replace(/\r?\n/g, '');

    // 处理私钥：如果没有私钥，显示提示信息并隐藏相关按钮
    const keySection = document.getElementById('certKeySection');
    const noKeyWarning = document.getElementById('noKeyWarning');
    const downloadKeyBtn = document.getElementById('downloadKeyBtn');
    const downloadAllBtn = document.getElementById('downloadAllBtn');

    if (cert.privateKey) {
        document.getElementById('certKeyContent').value = cert.privateKey.replace(/\r?\n/g, '');
        if (keySection) keySection.style.display = 'block';
        if (noKeyWarning) noKeyWarning.style.display = 'none';
        if (downloadKeyBtn) downloadKeyBtn.style.display = 'inline-flex';
        if (downloadAllBtn) downloadAllBtn.style.display = 'inline-flex';
    } else {
        document.getElementById('certKeyContent').value = '';
        if (keySection) keySection.style.display = 'none';
        if (noKeyWarning) noKeyWarning.style.display = 'block';
        if (downloadKeyBtn) downloadKeyBtn.style.display = 'none';
        if (downloadAllBtn) downloadAllBtn.style.display = 'none';
    }
}

// 申请证书
async function applyCertificate() {
    const btn = document.getElementById('applyCertBtn');
    const errorEl = document.getElementById('certError');

    btn.disabled = true;
    btn.textContent = '申请中...';
    errorEl.textContent = '';

    try {
        const res = await fetch(`/api/dns/${currentAccountId}/certificates`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ hostname: currentCertHostname })
        });

        const data = await res.json();

        if (data.success && data.certificate) {
            currentCertData = data.certificate;
            showCertApplied(data.certificate);
            // 刷新记录列表以更新SSL按钮颜色
            if (currentAccountId) {
                loadRecords(currentAccountId, currentRecordPage);
            }
        } else {
            errorEl.textContent = data.error || '申请证书失败';
        }
    } catch (error) {
        errorEl.textContent = '申请失败: ' + error.message;
    } finally {
        btn.disabled = false;
        btn.textContent = '申请证书';
    }
}

// 复制证书 PEM
function copyCertPem() {
    const pem = document.getElementById('certPemContent').value;
    if (!pem) return;

    navigator.clipboard.writeText(pem).then(() => {
        showCopyToast('证书已复制到剪贴板');
    }).catch(err => {
        console.error('复制失败:', err);
    });
}

// 复制私钥
function copyCertKey() {
    const key = document.getElementById('certKeyContent').value;
    if (!key) return;

    navigator.clipboard.writeText(key).then(() => {
        showCopyToast('私钥已复制到剪贴板');
    }).catch(err => {
        console.error('复制失败:', err);
    });
}

// 显示复制提示
function showCopyToast(message) {
    // 创建提示元素
    const toast = document.createElement('div');
    toast.textContent = message;
    toast.style.cssText = `
        position: fixed;
        bottom: 20px;
        left: 50%;
        transform: translateX(-50%);
        background: #22c55e;
        color: white;
        padding: 0.75rem 1.5rem;
        border-radius: 8px;
        font-size: 0.875rem;
        z-index: 10000;
        animation: fadeInOut 2s ease-in-out;
    `;

    // 添加动画样式
    if (!document.getElementById('toastStyles')) {
        const style = document.createElement('style');
        style.id = 'toastStyles';
        style.textContent = `
            @keyframes fadeInOut {
                0% { opacity: 0; transform: translateX(-50%) translateY(20px); }
                15% { opacity: 1; transform: translateX(-50%) translateY(0); }
                85% { opacity: 1; transform: translateX(-50%) translateY(0); }
                100% { opacity: 0; transform: translateX(-50%) translateY(-20px); }
            }
        `;
        document.head.appendChild(style);
    }

    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 2000);
}

// 下载证书
function downloadCert(type) {
    if (!currentCertData) return;

    const hostname = currentCertHostname.replace(/\./g, '_');

    if (type === 'pem' || type === 'both') {
        downloadFile(`${hostname}.pem`, currentCertData.certificate);
    }

    if (type === 'key' || type === 'both') {
        downloadFile(`${hostname}.key`, currentCertData.privateKey);
    }
}

// 下载文件辅助函数
function downloadFile(filename, content) {
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// 显示确认模态框
function showConfirmModal(title, message, onConfirm) {
    const modal = document.getElementById('confirmModal');
    document.getElementById('confirmTitle').textContent = title;
    document.getElementById('confirmMessage').textContent = message;
    modal.classList.add('active');

    // 取消按钮
    document.getElementById('confirmCancelBtn').onclick = () => {
        modal.classList.remove('active');
    };

    // 确认按钮
    document.getElementById('confirmOkBtn').onclick = () => {
        modal.classList.remove('active');
        onConfirm();
    };
}

// 撤销证书
function revokeCertificate(certId) {
    showConfirmModal(
        '确认撤销',
        '确定要撤销此证书吗？撤销后证书将立即失效，无法恢复。',
        async () => {
            const btn = document.getElementById('revokeCertBtn');
            const errorEl = document.getElementById('certError');

            btn.disabled = true;
            btn.textContent = '撤销中...';
            errorEl.textContent = '';

            try {
                const res = await fetch(`/api/dns/${currentAccountId}/certificates/${certId}`, {
                    method: 'DELETE'
                });

                const data = await res.json();

                if (data.success) {
                    currentCertData = null;
                    showCertNotApplied();
                    showCopyToast('证书已撤销');
                    // 刷新记录列表以更新SSL按钮颜色
                    if (currentAccountId) {
                        loadRecords(currentAccountId, currentRecordPage);
                    }
                } else {
                    errorEl.textContent = data.error || '撤销证书失败';
                }
            } catch (error) {
                errorEl.textContent = '撤销失败: ' + error.message;
            } finally {
                btn.disabled = false;
                btn.textContent = '撤销证书';
            }
        }
    );
}

// 导出证书相关函数到全局
window.openCertModal = openCertModal;
window.copyCertPem = copyCertPem;
window.copyCertKey = copyCertKey;
window.downloadCert = downloadCert;
window.revokeCertificate = revokeCertificate;

// ========== 批量申请 SSL 证书 ==========

let batchSSLResults = []; // 存储批量申请的结果

// 批量申请SSL按钮点击事件
document.getElementById('batchSSLBtn').addEventListener('click', batchApplySSL);
document.getElementById('closeBatchSSLBtn').addEventListener('click', () => {
    document.getElementById('batchSSLModal').classList.remove('active');
    // 刷新记录列表以更新SSL按钮颜色
    if (currentAccountId) {
        loadRecords(currentAccountId, currentRecordPage);
    }
});
document.getElementById('downloadAllCertsBtn').addEventListener('click', downloadAllCerts);

// 批量申请SSL证书
async function batchApplySSL() {
    const hostnames = Array.from(selectedRecords).map(id => {
        const rec = currentRecords.find(r => r.id === id);
        return rec ? rec.name : null;
    }).filter(Boolean);

    if (hostnames.length === 0) {
        alert('请先选择要申请SSL证书的记录');
        return;
    }

    // 显示进度模态框
    const modal = document.getElementById('batchSSLModal');
    const statusEl = document.getElementById('batchSSLStatus');
    const progressEl = document.getElementById('batchSSLProgress');
    const countEl = document.getElementById('batchSSLCount');
    const actionsEl = document.getElementById('batchSSLActions');
    const titleEl = document.getElementById('batchSSLTitle');

    modal.classList.add('active');
    titleEl.textContent = '批量申请 SSL 证书';
    statusEl.textContent = '正在申请证书...';
    progressEl.style.width = '0%';
    countEl.textContent = `0 / ${hostnames.length}`;
    actionsEl.style.display = 'none';
    batchSSLResults = [];

    let completed = 0;
    const total = hostnames.length;

    // 获取现有证书列表
    let existingCerts = [];
    try {
        const certsRes = await fetch(`/api/dns/${currentAccountId}/certificates`);
        const certs = await certsRes.json();
        existingCerts = Array.isArray(certs) ? certs : [];
    } catch (e) {
        console.error('获取证书列表失败', e);
    }

    // 并发申请（使用 Promise.all）
    const applyPromises = hostnames.map(async (hostname) => {
        try {
            // 检查是否已有证书，如有则先撤销
            const existingCert = existingCerts.find(c =>
                c.hostname === hostname || (c.hostnames && c.hostnames.includes(hostname))
            );

            if (existingCert) {
                // 撤销旧证书
                await fetch(`/api/dns/${currentAccountId}/certificates/${existingCert.id}`, {
                    method: 'DELETE'
                });
            }

            // 申请新证书
            const res = await fetch(`/api/dns/${currentAccountId}/certificates`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ hostname })
            });

            const data = await res.json();

            completed++;
            const percent = Math.round((completed / total) * 100);
            progressEl.style.width = `${percent}%`;
            countEl.textContent = `${completed} / ${total}`;

            if (data.success && data.certificate) {
                batchSSLResults.push({
                    hostname,
                    success: true,
                    certificate: data.certificate.certificate,
                    privateKey: data.certificate.privateKey
                });
                return { hostname, success: true };
            } else {
                batchSSLResults.push({ hostname, success: false, error: data.error });
                return { hostname, success: false, error: data.error };
            }
        } catch (error) {
            completed++;
            const percent = Math.round((completed / total) * 100);
            progressEl.style.width = `${percent}%`;
            countEl.textContent = `${completed} / ${total}`;
            batchSSLResults.push({ hostname, success: false, error: error.message });
            return { hostname, success: false, error: error.message };
        }
    });

    await Promise.all(applyPromises);

    // 完成
    const successCount = batchSSLResults.filter(r => r.success).length;
    titleEl.textContent = '申请完成';
    statusEl.textContent = `成功 ${successCount} 个，失败 ${total - successCount} 个`;
    progressEl.style.width = '100%';
    actionsEl.style.display = 'flex';
}

// 下载全部证书
function downloadAllCerts() {
    const successCerts = batchSSLResults.filter(r => r.success);

    if (successCerts.length === 0) {
        alert('没有可下载的证书');
        return;
    }

    // 逐个下载证书文件
    successCerts.forEach(cert => {
        const hostname = cert.hostname.replace(/\./g, '_');
        downloadFile(`${hostname}.pem`, cert.certificate);
        downloadFile(`${hostname}.key`, cert.privateKey);
    });

    showCopyToast(`已下载 ${successCerts.length} 个证书`);
}

// 批量撤销SSL按钮点击事件
document.getElementById('batchRevokeSSLBtn').addEventListener('click', batchRevokeSSL);

// 批量撤销SSL证书
async function batchRevokeSSL() {
    const hostnames = Array.from(selectedRecords).map(id => {
        const rec = currentRecords.find(r => r.id === id);
        return rec ? rec.name : null;
    }).filter(Boolean);

    if (hostnames.length === 0) {
        alert('请先选择要撤销SSL证书的记录');
        return;
    }

    // 显示进度模态框
    const modal = document.getElementById('batchSSLModal');
    const statusEl = document.getElementById('batchSSLStatus');
    const progressEl = document.getElementById('batchSSLProgress');
    const countEl = document.getElementById('batchSSLCount');
    const actionsEl = document.getElementById('batchSSLActions');
    const titleEl = document.getElementById('batchSSLTitle');
    const downloadBtn = document.getElementById('downloadAllCertsBtn');

    modal.classList.add('active');
    titleEl.textContent = '批量撤销 SSL 证书';
    statusEl.textContent = '正在撤销证书...';
    progressEl.style.width = '0%';
    progressEl.style.background = 'linear-gradient(90deg, #f59e0b, #d97706)';
    countEl.textContent = `0 / ${hostnames.length}`;
    actionsEl.style.display = 'none';
    downloadBtn.style.display = 'none';

    let completed = 0;
    let revokedCount = 0;
    let skippedCount = 0;
    const total = hostnames.length;

    // 获取现有证书列表
    let existingCerts = [];
    try {
        const certsRes = await fetch(`/api/dns/${currentAccountId}/certificates`);
        const certs = await certsRes.json();
        existingCerts = Array.isArray(certs) ? certs : [];
    } catch (e) {
        console.error('获取证书列表失败', e);
    }

    // 并发撤销
    const revokePromises = hostnames.map(async (hostname) => {
        try {
            // 查找该域名的证书
            const cert = existingCerts.find(c =>
                c.hostname === hostname || (c.hostnames && c.hostnames.includes(hostname))
            );

            if (!cert) {
                // 没有证书，跳过
                completed++;
                skippedCount++;
                const percent = Math.round((completed / total) * 100);
                progressEl.style.width = `${percent}%`;
                countEl.textContent = `${completed} / ${total}`;
                return { hostname, skipped: true };
            }

            // 撤销证书
            await fetch(`/api/dns/${currentAccountId}/certificates/${cert.id}`, {
                method: 'DELETE'
            });

            completed++;
            revokedCount++;
            const percent = Math.round((completed / total) * 100);
            progressEl.style.width = `${percent}%`;
            countEl.textContent = `${completed} / ${total}`;
            return { hostname, success: true };
        } catch (error) {
            completed++;
            const percent = Math.round((completed / total) * 100);
            progressEl.style.width = `${percent}%`;
            countEl.textContent = `${completed} / ${total}`;
            return { hostname, success: false, error: error.message };
        }
    });

    await Promise.all(revokePromises);

    // 完成
    titleEl.textContent = '撤销完成';
    let statusText = `已撤销 ${revokedCount} 个`;
    if (skippedCount > 0) {
        statusText += `，跳过 ${skippedCount} 个（无证书）`;
    }
    statusEl.textContent = statusText;
    progressEl.style.width = '100%';
    actionsEl.style.display = 'flex';
    downloadBtn.style.display = 'none';
}
