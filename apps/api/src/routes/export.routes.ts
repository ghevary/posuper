// ============================================================
// POS Yoga — Excel Export Routes
// ============================================================

import type { FastifyInstance } from 'fastify';
import { db } from '../db/index.js';
import {
  transactions, transactionItems, user, expenses,
  products, categories, productVariants, categoryOptionGroups, categoryOptions
} from '../db/schema.js';
import { eq, gte, lte, and, desc, ilike } from 'drizzle-orm';
import { requireRole } from '../middleware/auth.middleware.js';
import ExcelJS from 'exceljs';

export async function exportRoutes(app: FastifyInstance) {
  // Helper for cell styling
  const styleHeaderCell = (cell: ExcelJS.Cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF009688' }, // Teal
    };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.border = {
      top: { style: 'thin' },
      left: { style: 'thin' },
      bottom: { style: 'thin' },
      right: { style: 'thin' },
    };
  };

  const styleDataCell = (cell: ExcelJS.Cell, align: 'left' | 'center' | 'right' = 'left') => {
    cell.alignment = { horizontal: align, vertical: 'middle' };
    cell.border = {
      top: { style: 'thin' },
      left: { style: 'thin' },
      bottom: { style: 'thin' },
      right: { style: 'thin' },
    };
  };

  // ─── 1. Export Transactions ─────────────────────────────────
  // Helper: date range for export
  function getExportDateRange(dateFilter: string, from?: string, to?: string): { start?: Date; end?: Date } {
    const now = new Date();
    const startOfDay = (d: Date) => { d.setHours(0, 0, 0, 0); return d; };
    const endOfDay = (d: Date) => { d.setHours(23, 59, 59, 999); return d; };

    switch (dateFilter) {
      case 'today':
        return { start: startOfDay(new Date(now)), end: endOfDay(new Date(now)) };
      case 'yesterday': {
        const y = new Date(now); y.setDate(y.getDate() - 1);
        return { start: startOfDay(y), end: endOfDay(new Date(y)) };
      }
      case 'this_week': {
        const d = new Date(now); d.setDate(d.getDate() - d.getDay());
        return { start: startOfDay(d), end: endOfDay(new Date(now)) };
      }
      case 'last_week': {
        const d = new Date(now); d.setDate(d.getDate() - d.getDay() - 7);
        const e = new Date(d); e.setDate(e.getDate() + 6);
        return { start: startOfDay(d), end: endOfDay(e) };
      }
      case 'this_month': {
        const d = new Date(now.getFullYear(), now.getMonth(), 1);
        return { start: startOfDay(d), end: endOfDay(new Date(now)) };
      }
      case 'last_month': {
        const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        const e = new Date(now.getFullYear(), now.getMonth(), 0);
        return { start: startOfDay(d), end: endOfDay(e) };
      }
      case 'custom':
        return {
          start: from ? new Date(`${from}T00:00:00`) : undefined,
          end: to ? new Date(`${to}T23:59:59`) : undefined,
        };
      default:
        return {
          start: from ? new Date(`${from}T00:00:00`) : undefined,
          end: to ? new Date(`${to}T23:59:59`) : undefined,
        };
    }
  }

  // ─── 1. Export Transactions ─────────────────────────────────
  app.get('/api/export/transactions', { preHandler: [requireRole('developer', 'admin', 'cashier')] }, async (req, reply) => {
    const { dateFilter, from, to, status, orderType, paymentMethod, userId, invoiceNo } = req.query as any;

    const dateConditions: any[] = [];
    const range = getExportDateRange(dateFilter || '', from, to);
    if (range.start) dateConditions.push(gte(transactions.createdAt, range.start));
    if (range.end) dateConditions.push(lte(transactions.createdAt, range.end));
    if (status && status !== 'all') dateConditions.push(eq(transactions.status, status));
    if (orderType && orderType !== 'all') dateConditions.push(eq(transactions.orderType, orderType));
    if (paymentMethod && paymentMethod !== 'all') dateConditions.push(eq(transactions.paymentMethod, paymentMethod));
    if (userId && userId !== 'all') dateConditions.push(eq(transactions.userId, userId));
    if (invoiceNo) dateConditions.push(ilike(transactions.invoiceNo, `%${invoiceNo}%`));

    const whereClause = dateConditions.length > 0 ? and(...dateConditions) : undefined;

    // Fetch transactions
    const txList = await db.select({
      id: transactions.id,
      invoiceNo: transactions.invoiceNo,
      createdAt: transactions.createdAt,
      cashierName: user.name,
      orderType: transactions.orderType,
      tableNo: transactions.tableNo,
      subtotal: transactions.subtotal,
      discount: transactions.discount,
      total: transactions.total,
      paymentMethod: transactions.paymentMethod,
      status: transactions.status,
    })
      .from(transactions)
      .leftJoin(user, eq(transactions.userId, user.id))
      .where(whereClause)
      .orderBy(desc(transactions.createdAt));

    // Fetch all products, product variants, and category options for intelligent cost resolution
    const [allProducts, allVariants, allCategoryOptions, allOptionGroups] = await Promise.all([
      db.select({
        id: products.id,
        name: products.name,
        cost: products.cost,
        price: products.price,
      }).from(products),
      db.select({
        id: productVariants.id,
        productId: productVariants.productId,
        name: productVariants.name,
        cost: productVariants.cost,
      }).from(productVariants),
      db.select({
        id: categoryOptions.id,
        groupId: categoryOptions.groupId,
        name: categoryOptions.name,
        cost: categoryOptions.cost,
        price: categoryOptions.price,
      }).from(categoryOptions),
      db.select({
        id: categoryOptionGroups.id,
        name: categoryOptionGroups.name,
      }).from(categoryOptionGroups),
    ]);

    // Build lookup indexes
    const variantById: Record<string, number> = {};
    const variantByProductAndName: Record<string, number> = {};
    const variantByProductNameAndName: Record<string, number> = {};
    const variantByName: Record<string, number> = {};
    const productById: Record<string, number> = {};
    const productByName: Record<string, number> = {};
    const categoryOptionByName: Record<string, number> = {};
    const groupOptionCostMap: Record<string, number> = {};
    const groupOptionPriceCostMap: Record<string, number> = {};

    const prodIdToName: Record<string, string> = {};
    const groupNameById: Record<string, string> = {};

    allOptionGroups.forEach(g => {
      if (g.name) groupNameById[g.id] = g.name.toLowerCase().trim();
    });

    allProducts.forEach((p) => {
      const pCost = Number(p.cost) || 0;
      productById[p.id] = pCost;
      if (p.name) {
        prodIdToName[p.id] = p.name;
        productByName[p.name.toLowerCase().trim()] = pCost;
      }
    });

    allVariants.forEach((v) => {
      const vCost = Number(v.cost) || 0;
      variantById[v.id] = vCost;
      if (v.name) {
        const vNameLower = v.name.toLowerCase().trim();
        variantByName[vNameLower] = vCost;
        if (v.productId) {
          variantByProductAndName[`${v.productId}__${vNameLower}`] = vCost;
          const pName = prodIdToName[v.productId];
          if (pName) {
            variantByProductNameAndName[`${pName.toLowerCase().trim()}__${vNameLower}`] = vCost;
          }
        }
      }
    });

    allCategoryOptions.forEach((opt) => {
      const optCost = Number(opt.cost) || 0;
      const optPrice = Math.round(Number(opt.price) || 0);
      const gName = groupNameById[opt.groupId || ''] || '';
      const oName = (opt.name || '').toLowerCase().trim();

      if (oName) {
        categoryOptionByName[oName] = optCost;
      }
      if (gName && oName) {
        const key = `${gName} ${oName}`;
        groupOptionCostMap[key] = optCost;
        groupOptionPriceCostMap[`${key}__${optPrice}`] = optCost;
        groupOptionCostMap[`+ ${key}`] = optCost;
        groupOptionPriceCostMap[`+ ${key}__${optPrice}`] = optCost;
      }
    });

    function resolveItemCost(item: any): number {
      const pName = (item.productName || '').trim();
      const pNameLower = pName.toLowerCase();
      const vName = (item.variantName || '').trim();
      const vNameLower = vName.toLowerCase();
      const itemPrice = Math.round(Number(item.price) || 0);

      // 1. Direct variant cost from join
      if (item.variantCost && Number(item.variantCost) > 0) {
        return Number(item.variantCost);
      }

      // 2. Lookup by variantId
      if (item.variantId && variantById[item.variantId] !== undefined && variantById[item.variantId] > 0) {
        return variantById[item.variantId];
      }

      // 3. Lookup by (productId + variantName)
      if (item.productId && vNameLower) {
        const key = `${item.productId}__${vNameLower}`;
        if (variantByProductAndName[key] !== undefined && variantByProductAndName[key] > 0) {
          return variantByProductAndName[key];
        }
      }

      // 4. Lookup by (productName + variantName) (e.g. spagetti + bolognese)
      if (pNameLower && vNameLower && vNameLower !== 'biasa' && vNameLower !== 'biasa / regular' && vNameLower !== 'regular' && vNameLower !== '-') {
        const key = `${pNameLower}__${vNameLower}`;
        if (variantByProductNameAndName[key] !== undefined && variantByProductNameAndName[key] > 0) {
          return variantByProductNameAndName[key];
        }
        if (variantByName[vNameLower] !== undefined && variantByName[vNameLower] > 0) {
          return variantByName[vNameLower];
        }
      }

      // 5. Cleaned sub-item / option check (e.g. "+ ayam crispy bbq spicy")
      const cleanName = pName.replace(/^\+\s*/, '').trim();
      const cleanNameLower = cleanName.toLowerCase();

      // Check group + option exact match (e.g. "ayam crispy bbq spicy" with price 12000)
      if (groupOptionPriceCostMap[`${cleanNameLower}__${itemPrice}`] !== undefined && groupOptionPriceCostMap[`${cleanNameLower}__${itemPrice}`] > 0) {
        return groupOptionPriceCostMap[`${cleanNameLower}__${itemPrice}`];
      }
      if (groupOptionCostMap[cleanNameLower] !== undefined && groupOptionCostMap[cleanNameLower] > 0) {
        return groupOptionCostMap[cleanNameLower];
      }
      if (groupOptionPriceCostMap[`${pNameLower}__${itemPrice}`] !== undefined && groupOptionPriceCostMap[`${pNameLower}__${itemPrice}`] > 0) {
        return groupOptionPriceCostMap[`${pNameLower}__${itemPrice}`];
      }
      if (groupOptionCostMap[pNameLower] !== undefined && groupOptionCostMap[pNameLower] > 0) {
        return groupOptionCostMap[pNameLower];
      }

      if (categoryOptionByName[cleanNameLower] !== undefined && categoryOptionByName[cleanNameLower] > 0) {
        return categoryOptionByName[cleanNameLower];
      }
      if (vNameLower && categoryOptionByName[vNameLower] !== undefined && categoryOptionByName[vNameLower] > 0) {
        return categoryOptionByName[vNameLower];
      }

      // Check across variants for match in cleanName (e.g. "bbq spicy" in "+ ayam crispy bbq spicy")
      for (const v of allVariants) {
        const vMatch = v.name.toLowerCase().trim();
        if (vMatch && cleanNameLower.includes(vMatch) && Number(v.cost) > 0) {
          return Number(v.cost);
        }
      }

      // Check across category options for match
      for (const opt of allCategoryOptions) {
        const optMatch = opt.name.toLowerCase().trim();
        if (optMatch && cleanNameLower.includes(optMatch) && Number(opt.cost) > 0) {
          return Number(opt.cost);
        }
      }

      // 6. Direct product cost
      if (item.productCost && Number(item.productCost) > 0) {
        return Number(item.productCost);
      }

      // 7. Product by ID or Name
      if (item.productId && productById[item.productId] !== undefined && productById[item.productId] > 0) {
        return productById[item.productId];
      }
      if (productByName[pNameLower] !== undefined && productByName[pNameLower] > 0) {
        return productByName[pNameLower];
      }
      if (productByName[cleanNameLower] !== undefined && productByName[cleanNameLower] > 0) {
        return productByName[cleanNameLower];
      }

      return 0;
    }

    // Fetch transaction items with details including variant cost
    const txIds = txList.map((t) => t.id);
    let itemsList: any[] = [];
    const itemsByTx: Record<string, any[]> = {};
    const productSalesMap: Record<string, { productName: string; variantName: string; qty: number; price: number; subtotal: number }> = {};

    if (txIds.length > 0) {
      itemsList = await db.select({
        transactionId: transactionItems.transactionId,
        invoiceNo: transactions.invoiceNo,
        createdAt: transactions.createdAt,
        productId: transactionItems.productId,
        productName: transactionItems.productName,
        variantId: transactionItems.variantId,
        variantName: transactionItems.variantName,
        qty: transactionItems.qty,
        price: transactionItems.price,
        subtotal: transactionItems.subtotal,
        note: transactionItems.note,
        productCost: products.cost,
        variantCost: productVariants.cost,
      })
        .from(transactionItems)
        .leftJoin(transactions, eq(transactionItems.transactionId, transactions.id))
        .leftJoin(products, eq(transactionItems.productId, products.id))
        .leftJoin(productVariants, eq(transactionItems.variantId, productVariants.id))
        .where(whereClause)
        .orderBy(desc(transactions.createdAt));

      itemsList.forEach((item) => {
        // Group by transaction
        if (!itemsByTx[item.transactionId]) itemsByTx[item.transactionId] = [];
        itemsByTx[item.transactionId].push(item);

        // Aggregate product sales summary (for Sheet 2)
        const key = `${item.productName}__${item.variantName || 'Biasa'}`;
        if (!productSalesMap[key]) {
          productSalesMap[key] = {
            productName: item.productName,
            variantName: item.variantName || 'Biasa / Regular',
            qty: 0,
            price: Number(item.price) || 0,
            subtotal: 0,
          };
        }
        productSalesMap[key].qty += Number(item.qty) || 0;
        productSalesMap[key].subtotal += Number(item.subtotal) || 0;
      });
    }

    const workbook = new ExcelJS.Workbook();

    // ─── Sheet 1: Ringkasan Invoice Transaksi ─────────────────
    const s1 = workbook.addWorksheet('Ringkasan Transaksi');
    s1.columns = [
      { header: 'No', key: 'no', width: 6 },
      { header: 'No Invoice', key: 'invoiceNo', width: 22 },
      { header: 'Tanggal', key: 'date', width: 14 },
      { header: 'Jam', key: 'time', width: 10 },
      { header: 'Kasir', key: 'cashier', width: 18 },
      { header: 'Tipe Pesanan', key: 'orderType', width: 16 },
      { header: 'Meja', key: 'tableNo', width: 10 },
      { header: 'Detail Menu', key: 'menuList', width: 32 },
      { header: 'Subtotal (Rp)', key: 'subtotal', width: 16 },
      { header: 'Diskon (Rp)', key: 'discount', width: 16 },
      { header: 'Total (Rp)', key: 'total', width: 16 },
      { header: 'Metode Bayar', key: 'paymentMethod', width: 16 },
      { header: 'Status', key: 'status', width: 14 },
    ];

    s1.getRow(1).eachCell((cell) => styleHeaderCell(cell));

    let totalSum = 0;
    txList.forEach((t, i) => {
      const d = new Date(t.createdAt);
      const txItems = itemsByTx[t.id] || [];

      // Clean menu summary list
      const menuList = txItems.length > 0
        ? txItems.map((it) => `${it.productName}${it.variantName ? ` (${it.variantName})` : ''} x${it.qty}`).join(', ')
        : '-';

      const row = s1.addRow({
        no: i + 1,
        invoiceNo: t.invoiceNo,
        date: d.toLocaleDateString('id-ID'),
        time: d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }),
        cashier: t.cashierName || '-',
        orderType: t.orderType === 'take_away' ? 'Take Away' : 'Dine In',
        tableNo: t.tableNo || '-',
        menuList,
        subtotal: Number(t.subtotal) || 0,
        discount: Number(t.discount) || 0,
        total: Number(t.total) || 0,
        paymentMethod: (t.paymentMethod || 'cash').toUpperCase(),
        status: (t.status || 'completed').toUpperCase(),
      });

      totalSum += Number(t.total) || 0;

      row.eachCell((cell, colNumber) => {
        const align = [1, 3, 4, 6, 7, 12, 13].includes(colNumber) ? 'center' : [9, 10, 11].includes(colNumber) ? 'right' : 'left';
        styleDataCell(cell, align);
        if ([9, 10, 11].includes(colNumber)) {
          cell.numFmt = '#,##0';
        }
      });
    });

    if (txList.length > 0) {
      const totalRow = s1.addRow({
        no: '',
        invoiceNo: 'TOTAL',
        date: '',
        time: '',
        cashier: '',
        orderType: '',
        tableNo: '',
        menuList: '',
        subtotal: '',
        discount: '',
        total: totalSum,
        paymentMethod: '',
        status: '',
      });
      totalRow.eachCell((cell, colNumber) => {
        styleHeaderCell(cell);
        if (colNumber === 11) {
          cell.numFmt = '#,##0';
        }
      });
    }

    // ─── Sheet 2: Rekapan Penjualan Per Produk (Persis Contoh Klien) ───
    const s2 = workbook.addWorksheet('Rekapan Penjualan Produk');
    s2.columns = [
      { header: 'No', key: 'no', width: 6 },
      { header: 'Nama Produk', key: 'productName', width: 30 },
      { header: 'Varian', key: 'variantName', width: 24 },
      { header: 'Jumlah Terjual', key: 'qty', width: 16 },
      { header: 'Harga Satuan (Rp)', key: 'price', width: 20 },
      { header: 'Total Revenue (Rp)', key: 'revenue', width: 22 },
    ];

    s2.getRow(1).eachCell((cell) => styleHeaderCell(cell));

    const salesList = Object.values(productSalesMap).sort((a, b) => b.qty - a.qty);
    let totalQtySum = 0;
    let totalRevenueSum = 0;

    salesList.forEach((item, i) => {
      totalQtySum += item.qty;
      totalRevenueSum += item.subtotal;

      const row = s2.addRow({
        no: i + 1,
        productName: item.productName,
        variantName: item.variantName,
        qty: item.qty,
        price: item.price,
        revenue: item.subtotal,
      });

      row.eachCell((cell, colNumber) => {
        const align = colNumber === 1 ? 'center' : [4, 5, 6].includes(colNumber) ? 'right' : 'left';
        styleDataCell(cell, align);
        if (colNumber === 4) {
          cell.numFmt = '#,##0';
        }
        if ([5, 6].includes(colNumber)) {
          cell.numFmt = '#,##0';
        }
      });
    });

    if (salesList.length > 0) {
      const summaryRow = s2.addRow({
        no: '',
        productName: 'TOTAL TERJUAL',
        variantName: '',
        qty: totalQtySum,
        price: '',
        revenue: totalRevenueSum,
      });
      summaryRow.eachCell((cell, colNumber) => {
        styleHeaderCell(cell);
        if (colNumber === 4 || colNumber === 6) {
          cell.numFmt = '#,##0';
        }
      });
    }

    // ─── Sheet 3: Detail Transaksi Per Baris ─────────────────
    const s3 = workbook.addWorksheet('Detail Items Per Baris');
    s3.columns = [
      { header: 'No', key: 'no', width: 6 },
      { header: 'No Invoice', key: 'invoiceNo', width: 22 },
      { header: 'Tanggal', key: 'date', width: 14 },
      { header: 'Nama Produk', key: 'productName', width: 28 },
      { header: 'Varian', key: 'variantName', width: 24 },
      { header: 'Jumlah Terjual', key: 'qty', width: 16 },
      { header: 'Harga Satuan (Rp)', key: 'price', width: 18 },
      { header: 'Subtotal Jual (Rp)', key: 'subtotal', width: 18 },
      { header: 'Harga Modal (Rp)', key: 'cost', width: 18 },
      { header: 'Total Modal (Rp)', key: 'totalCost', width: 18 },
      { header: 'Margin / Keuntungan (Rp)', key: 'margin', width: 24 },
      { header: 'Catatan Item', key: 'note', width: 24 },
    ];

    s3.getRow(1).eachCell((cell) => styleHeaderCell(cell));

    let s3TotalQtySum = 0;
    let s3TotalSubtotalSum = 0;
    let s3TotalCostSum = 0;
    let s3TotalMarginSum = 0;

    itemsList.forEach((it, i) => {
      const rowNum = i + 2; // Row 1 is header
      const d = it.createdAt ? new Date(it.createdAt) : new Date();
      const qtyVal = Number(it.qty) || 0;
      const priceVal = Number(it.price) || 0;
      const costVal = resolveItemCost(it);
      const subtotalVal = Number(it.subtotal) || (qtyVal * priceVal);
      const totalCostVal = qtyVal * costVal;
      const marginVal = subtotalVal - totalCostVal;

      s3TotalQtySum += qtyVal;
      s3TotalSubtotalSum += subtotalVal;
      s3TotalCostSum += totalCostVal;
      s3TotalMarginSum += marginVal;

      const row = s3.addRow({
        no: i + 1,
        invoiceNo: it.invoiceNo || '-',
        date: d.toLocaleDateString('id-ID'),
        productName: it.productName,
        variantName: it.variantName || 'Biasa / Regular',
        qty: qtyVal,
        price: priceVal,
        subtotal: { formula: `F${rowNum}*G${rowNum}`, result: subtotalVal },
        cost: costVal,
        totalCost: { formula: `F${rowNum}*I${rowNum}`, result: totalCostVal },
        margin: { formula: `H${rowNum}-J${rowNum}`, result: marginVal },
        note: it.note || '-',
      });

      row.eachCell((cell, colNumber) => {
        const align = [1, 3].includes(colNumber) ? 'center' : [6, 7, 8, 9, 10, 11].includes(colNumber) ? 'right' : 'left';
        styleDataCell(cell, align);
        if ([6, 7, 8, 9, 10, 11].includes(colNumber)) {
          cell.numFmt = '#,##0';
        }
      });
    });

    if (itemsList.length > 0) {
      const summaryRow = s3.addRow({
        no: '',
        invoiceNo: 'TOTAL',
        date: '',
        productName: '',
        variantName: '',
        qty: s3TotalQtySum,
        price: '',
        subtotal: s3TotalSubtotalSum,
        cost: '',
        totalCost: s3TotalCostSum,
        margin: s3TotalMarginSum,
        note: '',
      });
      summaryRow.eachCell((cell, colNumber) => {
        styleHeaderCell(cell);
        if ([6, 8, 10, 11].includes(colNumber)) {
          cell.numFmt = '#,##0';
        }
      });
    }

    const buffer = await workbook.xlsx.writeBuffer();
    const dateTag = from && to ? `${from}_to_${to}` : new Date().toISOString().slice(0, 10);
    return reply
      .header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .header('Content-Disposition', `attachment; filename="transaksi_${dateTag}.xlsx"`)
      .send(Buffer.from(buffer as ArrayBuffer));
  });

  // ─── 2. Export Expenses ────────────────────────────────────
  app.get('/api/export/expenses', { preHandler: [requireRole('developer', 'admin')] }, async (req, reply) => {
    const { from, to } = req.query as { from?: string; to?: string };

    const conditions: any[] = [];
    if (from && to) {
      const [fYear, fMonth, fDay] = from.split('-').map(Number);
      const [tYear, tMonth, tDay] = to.split('-').map(Number);
      const startDate = new Date(Date.UTC(fYear, fMonth - 1, fDay, 0, 0, 0, 0) - 7 * 3600 * 1000);
      const endDate = new Date(Date.UTC(tYear, tMonth - 1, tDay, 23, 59, 59, 999) - 7 * 3600 * 1000);
      conditions.push(gte(expenses.date, startDate));
      conditions.push(lte(expenses.date, endDate));
    } else if (from) {
      const [fYear, fMonth, fDay] = from.split('-').map(Number);
      const startDate = new Date(Date.UTC(fYear, fMonth - 1, fDay, 0, 0, 0, 0) - 7 * 3600 * 1000);
      conditions.push(gte(expenses.date, startDate));
    } else if (to) {
      const [tYear, tMonth, tDay] = to.split('-').map(Number);
      const endDate = new Date(Date.UTC(tYear, tMonth - 1, tDay, 23, 59, 59, 999) - 7 * 3600 * 1000);
      conditions.push(lte(expenses.date, endDate));
    }

    const expList = await db.select({
      id: expenses.id,
      description: expenses.description,
      amount: expenses.amount,
      date: expenses.date,
      recordedBy: user.name,
    })
      .from(expenses)
      .leftJoin(user, eq(expenses.userId, user.id))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(expenses.date));

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Pengeluaran Operasional');

    sheet.columns = [
      { header: 'No', key: 'no', width: 6 },
      { header: 'Tanggal', key: 'date', width: 14 },
      { header: 'Jam', key: 'time', width: 10 },
      { header: 'Deskripsi Pengeluaran', key: 'description', width: 38 },
      { header: 'Jumlah (Rp)', key: 'amount', width: 20 },
      { header: 'Dicatat Oleh', key: 'recordedBy', width: 22 },
    ];

    sheet.getRow(1).eachCell((cell) => styleHeaderCell(cell));

    // Security: Helper to prevent Excel formula injection
    const sanitizeText = (val: string | null | undefined) => {
      if (!val) return '-';
      const s = String(val).trim();
      return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
    };

    let sumExpense = 0;
    expList.forEach((e, i) => {
      const rawDate = e.date ? new Date(e.date) : new Date();
      // WIB Time conversion (UTC+7)
      const wibDate = new Date(rawDate.getTime() + 7 * 60 * 60 * 1000);
      const dateStr = `${wibDate.getUTCDate().toString().padStart(2, '0')}/${(wibDate.getUTCMonth() + 1).toString().padStart(2, '0')}/${wibDate.getUTCFullYear()}`;
      const timeStr = `${wibDate.getUTCHours().toString().padStart(2, '0')}:${wibDate.getUTCMinutes().toString().padStart(2, '0')}`;
      const amt = Number(e.amount) || 0;
      sumExpense += amt;

      const row = sheet.addRow({
        no: i + 1,
        date: dateStr,
        time: timeStr,
        description: sanitizeText(e.description),
        amount: amt,
        recordedBy: sanitizeText(e.recordedBy || '-'),
      });

      row.eachCell((cell, colNumber) => {
        const align = [1, 2, 3].includes(colNumber) ? 'center' : colNumber === 5 ? 'right' : 'left';
        styleDataCell(cell, align);
        if (colNumber === 5) cell.numFmt = '#,##0';
      });
    });

    if (expList.length > 0) {
      const totalRow = sheet.addRow({
        no: '',
        date: '',
        time: '',
        description: 'TOTAL PENGELUARAN',
        amount: sumExpense,
        recordedBy: '',
      });
      totalRow.eachCell((cell, colNumber) => {
        styleHeaderCell(cell);
        if (colNumber === 5) cell.numFmt = '#,##0';
      });
    }

    const buffer = await workbook.xlsx.writeBuffer();
    const dateTag = from && to ? `${from}_to_${to}` : from ? `from_${from}` : new Date().toISOString().slice(0, 10);
    return reply
      .header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .header('Content-Disposition', `attachment; filename="pengeluaran_${dateTag}.xlsx"`)
      .send(Buffer.from(buffer as ArrayBuffer));
  });

  // ─── 3. Export Menu & Options ──────────────────────────────
  app.get('/api/export/menu', { preHandler: [requireRole('developer', 'admin')] }, async (req, reply) => {
    const prodList = await db.select({
      id: products.id,
      name: products.name,
      categoryId: products.categoryId,
      categoryName: categories.name,
      sku: products.sku,
      barcode: products.barcode,
      price: products.price,
      cost: products.cost,
      stock: products.stock,
      isActive: products.isActive,
    })
      .from(products)
      .leftJoin(categories, eq(products.categoryId, categories.id));

    const varList = await db.select({
      productId: productVariants.productId,
      productName: products.name,
      variantName: productVariants.name,
      additionalPrice: productVariants.additionalPrice,
    })
      .from(productVariants)
      .leftJoin(products, eq(productVariants.productId, products.id));

    const optList = await db.select({
      categoryId: categoryOptionGroups.categoryId,
      categoryName: categories.name,
      groupName: categoryOptionGroups.name,
      optionName: categoryOptions.name,
      price: categoryOptions.price,
      isRequired: categoryOptionGroups.isRequired,
      isMultiple: categoryOptionGroups.isMultiple,
    })
      .from(categoryOptions)
      .leftJoin(categoryOptionGroups, eq(categoryOptions.groupId, categoryOptionGroups.id))
      .leftJoin(categories, eq(categoryOptionGroups.categoryId, categories.id));

    // Group variants by productId
    const variantsByProduct: Record<string, string[]> = {};
    varList.forEach((v) => {
      if (!v.productId) return;
      if (!variantsByProduct[v.productId]) variantsByProduct[v.productId] = [];
      const addPrice = Number(v.additionalPrice) || 0;
      const priceStr = addPrice > 0 ? ` (+Rp ${addPrice.toLocaleString('id-ID')})` : '';
      variantsByProduct[v.productId].push(`${v.variantName}${priceStr}`);
    });

    // Group options by categoryId
    const optionsByCategory: Record<string, string[]> = {};
    optList.forEach((o) => {
      if (!o.categoryId) return;
      if (!optionsByCategory[o.categoryId]) optionsByCategory[o.categoryId] = [];
      const price = Number(o.price) || 0;
      const priceStr = price > 0 ? ` (+Rp ${price.toLocaleString('id-ID')})` : '';
      optionsByCategory[o.categoryId].push(`${o.groupName}: ${o.optionName}${priceStr}`);
    });

    const workbook = new ExcelJS.Workbook();

    // Sheet 1: Daftar Produk + Varian & Sub Varian
    const s1 = workbook.addWorksheet('Daftar Produk');
    s1.columns = [
      { header: 'No', key: 'no', width: 6 },
      { header: 'Nama Produk', key: 'name', width: 28 },
      { header: 'Kategori', key: 'category', width: 18 },
      { header: 'Varian Produk', key: 'variants', width: 32 },
      { header: 'Sub Varian / Addon Kategori', key: 'options', width: 40 },
      { header: 'SKU', key: 'sku', width: 14 },
      { header: 'Barcode', key: 'barcode', width: 16 },
      { header: 'Harga Jual (Rp)', key: 'price', width: 16 },
      { header: 'Harga Modal (Rp)', key: 'cost', width: 16 },
      { header: 'Stok', key: 'stock', width: 10 },
      { header: 'Status', key: 'status', width: 12 },
    ];
    s1.getRow(1).eachCell((cell) => styleHeaderCell(cell));

    prodList.forEach((p, i) => {
      const productVars = variantsByProduct[p.id]?.join(', ') || '-';
      const catOpts = (p.categoryId && optionsByCategory[p.categoryId]) ? optionsByCategory[p.categoryId].join('; ') : '-';

      const row = s1.addRow({
        no: i + 1,
        name: p.name,
        category: p.categoryName || '-',
        variants: productVars,
        options: catOpts,
        sku: p.sku || '-',
        barcode: p.barcode || '-',
        price: Number(p.price) || 0,
        cost: Number(p.cost) || 0,
        stock: p.stock,
        status: p.isActive ? 'Aktif' : 'Non-Aktif',
      });

      row.eachCell((cell, colNumber) => {
        const align = [1, 6, 7, 10, 11].includes(colNumber) ? 'center' : [8, 9].includes(colNumber) ? 'right' : 'left';
        styleDataCell(cell, align);
        if ([8, 9].includes(colNumber)) cell.numFmt = '#,##0';
      });
    });

    // Sheet 2: Detail Varian Produk
    const s2 = workbook.addWorksheet('Varian Produk');
    s2.columns = [
      { header: 'No', key: 'no', width: 6 },
      { header: 'Nama Produk', key: 'productName', width: 28 },
      { header: 'Nama Varian', key: 'variantName', width: 22 },
      { header: 'Harga Tambahan (Rp)', key: 'additionalPrice', width: 20 },
    ];
    s2.getRow(1).eachCell((cell) => styleHeaderCell(cell));

    varList.forEach((v, i) => {
      const row = s2.addRow({
        no: i + 1,
        productName: v.productName || '-',
        variantName: v.variantName,
        additionalPrice: Number(v.additionalPrice) || 0,
      });
      row.eachCell((cell, colNumber) => {
        const align = colNumber === 1 ? 'center' : colNumber === 4 ? 'right' : 'left';
        styleDataCell(cell, align);
        if (colNumber === 4) cell.numFmt = '#,##0';
      });
    });

    // Sheet 3: Opsi / Addon Kategori
    const s3 = workbook.addWorksheet('Opsi & Addon Kategori');
    s3.columns = [
      { header: 'No', key: 'no', width: 6 },
      { header: 'Kategori', key: 'categoryName', width: 20 },
      { header: 'Grup Opsi', key: 'groupName', width: 22 },
      { header: 'Nama Opsi', key: 'optionName', width: 22 },
      { header: 'Harga Opsi (Rp)', key: 'price', width: 16 },
      { header: 'Wajib Select', key: 'isRequired', width: 14 },
      { header: 'Multi Select', key: 'isMultiple', width: 14 },
    ];
    s3.getRow(1).eachCell((cell) => styleHeaderCell(cell));

    optList.forEach((o, i) => {
      const row = s3.addRow({
        no: i + 1,
        categoryName: o.categoryName || '-',
        groupName: o.groupName || '-',
        optionName: o.optionName,
        price: Number(o.price) || 0,
        isRequired: o.isRequired ? 'Ya' : 'Tidak',
        isMultiple: o.isMultiple ? 'Ya' : 'Tidak',
      });
      row.eachCell((cell, colNumber) => {
        const align = [1, 6, 7].includes(colNumber) ? 'center' : colNumber === 5 ? 'right' : 'left';
        styleDataCell(cell, align);
        if (colNumber === 5) cell.numFmt = '#,##0';
      });
    });

    const buffer = await workbook.xlsx.writeBuffer();
    return reply
      .header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .header('Content-Disposition', 'attachment; filename="menu_produk.xlsx"')
      .send(Buffer.from(buffer as ArrayBuffer));
  });
}
