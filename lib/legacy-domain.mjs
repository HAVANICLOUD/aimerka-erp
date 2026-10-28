// Original v1 motor retained as an ESM factory for the server.
const legacy=(function(){
  'use strict';

  // Demonstration only. Prices, commissions, deductions and stock are examples.
  // One line per order; no real connector, payment or stock publication exists.
  var ACCOUNT = 'HAVANI · demo';
  var MARKETS = {
    'Liverpool': { code: 'LIV', commission: 1900 },
    'Sears': { code: 'SEA', commission: 1800 },
    'Sanborns': { code: 'SAN', commission: 1700 },
    'Coppel': { code: 'COP', commission: 1500 },
    'Elektra': { code: 'ELE', commission: 1400 },
    'Tienda Nube': { code: 'TN', commission: 300 },
    'Mercado Libre': { code: 'ML', commission: 1700 }
  };

  function available(product) {
    return Math.max(0, product.good - product.reserved - product.safety);
  }

  function orderTotal(order) {
    return order.qty * order.unitPriceCents;
  }

  function expectedNet(order) {
    var gross = orderTotal(order);
    return gross - Math.round(gross * order.commissionBps / 10000)
      - Math.round(gross * order.msiBps / 10000)
      - order.shippingCents - order.withholdingCents;
  }

  function orderLabel(order) {
    if (order.status === 'cancelled') return { text: 'Cancelado', tone: 'slate' };
    if (order.returnStatus === 'inspection') return { text: 'En inspección', tone: 'amber' };
    if (order.returnStatus === 'restocked') return { text: 'Reintegrado', tone: 'green' };
    if (order.returnStatus === 'rejected') return { text: 'No vendible', tone: 'red' };
    if (order.returnStatus === 'requested') return { text: 'Devolución solicitada', tone: 'amber' };
    if (order.paymentStatus === 'refunded') return { text: 'Reembolso registrado', tone: 'red' };
    if (order.status === 'delivered') return { text: 'Entregado', tone: 'green' };
    if (order.status === 'shipped') return { text: 'Enviado', tone: 'blue' };
    return { text: 'Reservado', tone: 'amber' };
  }

  function createState() {
    var products = [
      { sku: 'DEMO-WATCH', name: 'Apple Watch SE', brand: 'Apple', category: 'Smartwatches', icon: 'watch', priceCents: 649900, costCents: 430000, good: 8, reserved: 0, quarantine: 0, damaged: 0, safety: 1, minStock: 3 },
      { sku: 'DEMO-MAC', name: 'MacBook Air', brand: 'Apple', category: 'Laptops', icon: 'laptop', priceCents: 2199900, costCents: 1550000, good: 5, reserved: 0, quarantine: 0, damaged: 0, safety: 1, minStock: 2 },
      { sku: 'DEMO-GALAXY', name: 'Samsung Galaxy', brand: 'Samsung', category: 'Celulares', icon: 'phone', priceCents: 1499900, costCents: 990000, good: 6, reserved: 0, quarantine: 0, damaged: 0, safety: 1, minStock: 3 },
      { sku: 'DEMO-AIRPODS', name: 'AirPods Pro', brand: 'Apple', category: 'Audio', icon: 'headphones', priceCents: 549900, costCents: 330000, good: 10, reserved: 0, quarantine: 0, damaged: 0, safety: 1, minStock: 4 },
      { sku: 'DEMO-PS5', name: 'PlayStation 5', brand: 'Sony', category: 'Videojuegos', icon: 'game', priceCents: 1199900, costCents: 790000, good: 6, reserved: 0, quarantine: 0, damaged: 0, safety: 1, minStock: 3 },
      { sku: 'DEMO-ECHO', name: 'Echo Dot', brand: 'Amazon', category: 'Audio', icon: 'speaker', priceCents: 129900, costCents: 70000, good: 18, reserved: 0, quarantine: 0, damaged: 0, safety: 2, minStock: 6 },
      { sku: 'DEMO-IPAD', name: 'iPad mini', brand: 'Apple', category: 'Tablets', icon: 'tablet', priceCents: 1099900, costCents: 720000, good: 4, reserved: 0, quarantine: 0, damaged: 0, safety: 1, minStock: 3 },
      { sku: 'DEMO-BUDS', name: 'Samsung Galaxy Buds', brand: 'Samsung', category: 'Audio', icon: 'headphones', priceCents: 249900, costCents: 145000, good: 9, reserved: 0, quarantine: 0, damaged: 0, safety: 1, minStock: 4 }
    ];
    var definitions = [
      ['Liverpool', 'DEMO-WATCH', 1, 'reserved', '2026-10-26T14:35:00Z'],
      ['Coppel', 'DEMO-MAC', 1, 'reserved', '2026-10-26T13:50:00Z'],
      ['Sears', 'DEMO-GALAXY', 1, 'shipped', '2026-10-25T16:20:00Z'],
      ['Elektra', 'DEMO-WATCH', 2, 'delivered', '2026-10-22T17:10:00Z'],
      ['Tienda Nube', 'DEMO-ECHO', 2, 'delivered', '2026-10-23T12:40:00Z'],
      ['Sanborns', 'DEMO-AIRPODS', 1, 'delivered', '2026-10-21T18:15:00Z'],
      ['Mercado Libre', 'DEMO-PS5', 1, 'reserved', '2026-10-26T12:25:00Z'],
      ['Liverpool', 'DEMO-MAC', 1, 'delivered', '2026-10-20T15:30:00Z'],
      ['Sears', 'DEMO-ECHO', 1, 'cancelled', '2026-10-24T19:05:00Z'],
      ['Coppel', 'DEMO-IPAD', 1, 'shipped', '2026-10-25T14:05:00Z'],
      ['Elektra', 'DEMO-BUDS', 2, 'reserved', '2026-10-26T11:10:00Z'],
      ['Tienda Nube', 'DEMO-GALAXY', 1, 'delivered', '2026-10-22T13:45:00Z']
    ];
    var orders = definitions.map(function (d, index) {
      var product = products.find(function (p) { return p.sku === d[1]; });
      var n = 1001 + index;
      var order = {
        id: 'DEMO-AIM-' + n,
        number: 'DEMO-' + MARKETS[d[0]].code + '-' + n,
        market: d[0], account: ACCOUNT,
        sicar: 'DEMO-SIC-' + n, ventiId: 'DEMO-VEN-' + n,
        date: d[4], sku: d[1], qty: d[2], unitPriceCents: product.priceCents,
        commissionBps: MARKETS[d[0]].commission,
        msiBps: d[0] === 'Elektra' ? 200 : 0,
        shippingCents: product.icon === 'laptop' ? 20000 : 12000,
        withholdingCents: 0, paidCents: 0,
        status: d[3], paymentStatus: d[3] === 'cancelled' ? 'refunded' : 'paid',
        returnStatus: 'none', incident: '',
        history: [{ label: 'Pedido de ejemplo importado; referencias ficticias.', date: d[4] }]
      };
      if (order.status === 'reserved') product.reserved += order.qty;
      if (order.status === 'shipped' || order.status === 'delivered') {
        order.history.push({ label: 'Salida de almacén registrada en el escenario inicial.', date: d[4] });
      }
      if (order.status === 'delivered') {
        order.history.push({ label: 'Entrega registrada en el escenario inicial.', date: d[4] });
        order.paidCents = expectedNet(order);
      }
      if (index === 3) {
        order.paidCents -= 12000;
        order.incident = 'Diferencia de liquidación de ejemplo: faltan $120.00 por conciliar.';
      }
      if (index === 5) {
        order.returnStatus = 'requested';
        order.incident = 'Devolución solicitada; mercancía todavía no recibida.';
        order.history.push({ label: 'Solicitud de devolución recibida. Sin entrada al inventario.', date: '2026-10-25T17:00:00Z' });
      }
      if (index === 11) {
        order.paidCents += 2500;
        order.incident = 'Diferencia de liquidación de ejemplo: $25.00 adicionales por identificar.';
      }
      if (order.status === 'cancelled') order.history.push({ label: 'Cancelación previa al envío; reserva liberada.', date: d[4] });
      return order;
    });
    return { schema: 1, products: products, orders: orders, events: [], processedEventIds: [], nextOrder: 1013 };
  }

  function fail(message, orderId) {
    return { ok: false, duplicate: false, message: message, orderId: orderId || null };
  }

  function success(message, orderId) {
    return { ok: true, duplicate: false, message: message, orderId: orderId };
  }

  function record(state, event, result, date) {
    state.processedEventIds.push(event.id);
    state.events.unshift({
      id: event.id, type: event.type || 'unknown', orderId: result.orderId,
      message: result.message, date: date, result: result.ok ? 'ok' : 'error'
    });
    if (result.ok) {
      var order = state.orders.find(function (o) { return o.id === result.orderId; });
      if (order) order.history.push({ label: result.message, date: date });
    }
    return result;
  }

  function applyEvent(state, event) {
    if (!state || state.schema !== 1 || !Array.isArray(state.products) || !Array.isArray(state.orders)
      || !Array.isArray(state.events) || !Array.isArray(state.processedEventIds)) {
      return fail('El estado de la demostración no es válido.');
    }
    if (!event || typeof event.id !== 'string' || !event.id.trim()) {
      return fail('Cada evento necesita un identificador para evitar duplicados.');
    }
    if (state.processedEventIds.indexOf(event.id) !== -1) {
      var previous = state.events.find(function (entry) { return entry.id === event.id; });
      return {
        ok: previous ? previous.result === 'ok' : true, duplicate: true,
        message: 'Evento ya procesado. No se repitieron movimientos.',
        orderId: previous ? previous.orderId : (event.orderId || null)
      };
    }
    var date = new Date().toISOString();
    var result;
    var order;
    var product;

    if (event.type === 'create') {
      product = state.products.find(function (p) { return p.sku === event.sku; });
      if (!product) result = fail('No se encontró el producto.');
      else if (!Number.isSafeInteger(event.qty) || event.qty <= 0) result = fail('La cantidad debe ser un número entero mayor que cero.');
      else if (!Object.prototype.hasOwnProperty.call(MARKETS, event.market)) result = fail('Selecciona uno de los canales de demostración.');
      else if (event.qty > available(product)) result = fail('Existencia insuficiente: hay ' + available(product) + ' unidades disponibles después del colchón de seguridad.');
      else {
        var n = state.nextOrder;
        order = {
          id: 'DEMO-AIM-' + n,
          number: 'DEMO-' + MARKETS[event.market].code + '-' + n,
          market: event.market, account: ACCOUNT, sicar: '', ventiId: 'DEMO-VEN-' + n,
          date: date, sku: product.sku, qty: event.qty, unitPriceCents: product.priceCents,
          commissionBps: MARKETS[event.market].commission, msiBps: event.market === 'Elektra' ? 200 : 0,
          shippingCents: product.icon === 'laptop' ? 20000 : 12000,
          withholdingCents: 0, paidCents: 0, status: 'reserved', paymentStatus: 'paid',
          returnStatus: 'none', incident: '', history: []
        };
        product.reserved += order.qty;
        state.nextOrder += 1;
        state.orders.unshift(order);
        result = success('Pedido simulado: ' + order.qty + ' unidad(es) reservadas. La existencia física no cambió.', order.id);
      }
      return record(state, event, result, date);
    }

    order = state.orders.find(function (o) { return o.id === event.orderId; });
    if (!order) return record(state, event, fail('No se encontró el pedido.', event.orderId), date);
    product = state.products.find(function (p) { return p.sku === order.sku; });
    if (!product) return record(state, event, fail('El pedido no tiene un producto válido.', order.id), date);

    switch (event.type) {
      case 'ship':
        if (order.status !== 'reserved') result = fail('Solo puede enviarse un pedido que tenga una reserva activa.', order.id);
        else if (order.paymentStatus === 'refunded') result = fail('Este pedido está reembolsado. Cancela la reserva antes de continuar.', order.id);
        else if (product.good < order.qty || product.reserved < order.qty) result = fail('El inventario requiere revisión antes de registrar la salida.', order.id);
        else {
          product.good -= order.qty;
          product.reserved -= order.qty;
          order.status = 'shipped';
          result = success('Envío registrado: salida física y cierre de reserva en un solo movimiento.', order.id);
        }
        break;

      case 'cancel':
        if (order.status === 'cancelled') result = fail('El pedido ya estaba cancelado; no hay otra reserva que liberar.', order.id);
        else if (order.status === 'reserved') {
          if (product.reserved < order.qty) result = fail('La reserva requiere revisión; no se modificó el inventario.', order.id);
          else {
            product.reserved -= order.qty;
            order.status = 'cancelled';
            result = success('Cancelación antes del envío: reserva liberada. No se creó una entrada física.', order.id);
          }
        } else if (order.returnStatus === 'inspection' || order.returnStatus === 'restocked' || order.returnStatus === 'rejected') {
          result = fail('La devolución ya avanzó; esta cancelación tardía no modifica existencias.', order.id);
        } else {
          order.incident = 'Cancelación posterior al envío: revisar con el canal y esperar devolución física.';
          order.returnStatus = 'requested';
          result = success('Cancelación posterior al envío: incidencia abierta, sin reintegro al inventario.', order.id);
        }
        break;

      case 'refund':
        if (order.paymentStatus === 'refunded') result = fail('El reembolso ya estaba registrado; no se repite.', order.id);
        else {
          order.paymentStatus = 'refunded';
          result = success('Reembolso registrado al comprador. No cambian existencias, reservas ni liquidaciones recibidas.', order.id);
        }
        break;

      case 'receive_return':
        if (order.status !== 'shipped' && order.status !== 'delivered') result = fail('Solo se recibe una devolución de mercancía que salió del almacén.', order.id);
        else if (order.returnStatus === 'inspection' || order.returnStatus === 'restocked' || order.returnStatus === 'rejected') result = fail('La devolución ya fue recibida; no se registra otra entrada.', order.id);
        else if (order.returnStatus !== 'requested' && order.paymentStatus !== 'refunded') result = fail('Primero debe existir una solicitud de devolución o un reembolso.', order.id);
        else {
          product.quarantine += order.qty;
          order.returnStatus = 'inspection';
          result = success('Devolución recibida en inspección. Las unidades aún no están disponibles para vender.', order.id);
        }
        break;

      case 'restock_return':
        if (order.returnStatus !== 'inspection') result = fail('Primero recibe la devolución y registra su inspección.', order.id);
        else if (product.quarantine < order.qty) result = fail('No hay suficientes unidades en inspección; revisa el movimiento.', order.id);
        else {
          product.quarantine -= order.qty;
          product.good += order.qty;
          order.returnStatus = 'restocked';
          order.incident = '';
          result = success('Inspección aprobada: ' + order.qty + ' unidad(es) reintegradas al inventario vendible.', order.id);
        }
        break;

      case 'reject_return':
        if (order.returnStatus !== 'inspection') result = fail('Primero recibe la devolución y registra su inspección.', order.id);
        else if (product.quarantine < order.qty) result = fail('No hay suficientes unidades en inspección; revisa el movimiento.', order.id);
        else {
          product.quarantine -= order.qty;
          product.damaged += order.qty;
          order.returnStatus = 'rejected';
          order.incident = 'Inspección rechazada: mercancía separada como no vendible.';
          result = success('Inspección rechazada: unidades trasladadas a no vendible, sin aumentar la disponibilidad.', order.id);
        }
        break;

      default:
        result = fail('Tipo de evento no reconocido.', order.id);
    }
    return record(state, event, result, date);
  }

  return { createState: createState, applyEvent: applyEvent, available: available, orderTotal: orderTotal, expectedNet: expectedNet, orderLabel: orderLabel };
})();
export default legacy;
