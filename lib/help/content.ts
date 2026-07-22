/**
 * Centro de ayuda contextual del SaaS.
 *
 * Documentación de USO por sección: para qué sirve, cómo se usa paso a paso y qué hace cada
 * configuración relevante. Es la fuente única de contenido; la consume el panel de ayuda
 * (botón "?" del header) resolviendo la ruta actual con `getHelpDoc(pathname)`.
 *
 * Al agregar una sección nueva: sumar su entrada acá (keyeada por la ruta). El resolver hace
 * match por prefijo, así que `/creditos/nuevo` cae en `/creditos` si no tiene entrada propia.
 */

export type HelpBlock =
  | { kind: "pasos"; titulo: string; pasos: string[] }
  | { kind: "definiciones"; titulo: string; items: { term: string; desc: string }[] }
  | { kind: "tips"; titulo: string; items: string[] }
  | { kind: "texto"; titulo: string; parrafos: string[] };

export interface HelpDoc {
  /** Título del panel (suele coincidir con el nombre de la sección). */
  titulo: string;
  /** Una o dos frases: para qué sirve la sección. */
  resumen: string;
  /** Bloques de contenido en orden de lectura. */
  bloques: HelpBlock[];
}

const HELP: Record<string, HelpDoc> = {
  // ─────────────────────────────────────────── Home / Panel ───
  "/": {
    titulo: "Panel principal",
    resumen:
      "Es tu tablero de control: los números clave del negocio de un vistazo. Lo que ves depende de tu rol — un vendedor ve solo su propia actividad; un administrador ve toda la financiera.",
    bloques: [
      {
        kind: "pasos",
        titulo: "Cómo se usa",
        pasos: [
          "Usá los filtros de arriba (fecha, zona y —si sos admin— empleado) para acotar el período que estás mirando.",
          "Revisá los KPIs: clientes, créditos, cartera activa y mora.",
          "Bajá al avance de cobranzas y a la exposición de mora para ver dónde poner el foco.",
          "Si sos admin, la tabla \"Rendimiento por vendedor\" compara la performance de cada uno.",
        ],
      },
      {
        kind: "definiciones",
        titulo: "Qué mira cada tarjeta",
        items: [
          { term: "Cartera activa", desc: "Capital que todavía está prestado y esperás cobrar." },
          { term: "Mora", desc: "Cuánto de esa cartera está vencido e impago, y qué tan crítico es." },
          { term: "Cotización del dólar", desc: "Referencia en vivo (blue como principal); clic para ver los otros tipos de cambio." },
        ],
      },
      {
        kind: "tips",
        titulo: "Atajos",
        items: [
          "Ctrl+K abre el buscador global para saltar a cualquier cliente, crédito o sección.",
          "La campanita del header avisa los movimientos de caja en vivo.",
        ],
      },
    ],
  },

  // ─────────────────────────────────────────── Clientes ───
  "/clientes": {
    titulo: "Clientes",
    resumen:
      "El registro de las personas a las que les prestás. Cada cliente tiene una ficha 360 con sus datos, sus créditos y su historial de pagos. El sueldo es la variable central del motor de riesgo.",
    bloques: [
      {
        kind: "pasos",
        titulo: "Cómo se usa",
        pasos: [
          "Buscá un cliente por nombre o DNI (F3 muestra la lista completa).",
          "Para uno nuevo, tocá \"Nuevo cliente\" y cargá sus datos: personales, domicilio y —obligatorio— el ingreso.",
          "Hacé clic en una fila para abrir su ficha 360: datos, créditos activos y pagos.",
          "Desde la ficha podés editar, otorgarle un crédito o registrarle un pago.",
        ],
      },
      {
        kind: "definiciones",
        titulo: "Puntos importantes",
        items: [
          { term: "Ingreso / sueldo", desc: "Es obligatorio: el motor de riesgo calcula con él la capacidad de pago y el monto máximo sugerido." },
          { term: "Candado del sueldo", desc: "Un vendedor puede editar el sueldo un número limitado de veces (se configura en Configuración → Riesgo). Agotado, solo un admin lo resetea." },
          { term: "Domicilio", desc: "Provincia y localidad se eligen encadenadas; si es departamento aparecen piso y depto." },
          { term: "Baja", desc: "Dar de baja un cliente se bloquea si tiene créditos activos o vencidos: primero hay que resolverlos." },
        ],
      },
    ],
  },

  // ─────────────────────────────────────────── Créditos ───
  "/creditos": {
    titulo: "Créditos",
    resumen:
      "El control de todos los créditos otorgados. Desde acá los seguís, los anulás, los eliminás o los refinanciás. Para otorgar uno nuevo se usa el simulador (\"Nuevo crédito\").",
    bloques: [
      {
        kind: "pasos",
        titulo: "Cómo se usa",
        pasos: [
          "La tabla lista los créditos con su estado, saldo y mora. Filtrá por estado o buscá por N° / cliente.",
          "Clic en una fila abre el detalle: cronograma de cuotas, pagos e info del crédito.",
          "Para uno nuevo, entrá a \"Nuevo crédito\" (el simulador).",
          "La pestaña \"Refinanciados\" muestra las reestructuraciones de deuda.",
        ],
      },
      {
        kind: "definiciones",
        titulo: "Acciones sobre un crédito",
        items: [
          { term: "Anular", desc: "Deshace el crédito conservando todo y registrando el motivo; revierte la caja. Es lo recomendado para corregir." },
          { term: "Eliminar", desc: "Borrado definitivo. Se bloquea si el crédito tiene pagos o un desembolso: en ese caso hay que anular." },
          { term: "Refinanciar", desc: "Solo créditos en mora: consolida la deuda viva en un crédito nuevo con quita opcional. No mueve caja." },
        ],
      },
      {
        kind: "tips",
        titulo: "Estados",
        items: [
          "Activo / Vencido / Pagado / Anulado / Refinanciado. El estado siempre refleja el ledger de cuotas, no se toca a mano.",
        ],
      },
    ],
  },
  "/creditos/nuevo": {
    titulo: "Nuevo crédito (simulador)",
    resumen:
      "Simulás y otorgás un crédito. Elegís al cliente, el monto/tasa/plazo y el sistema arma el plan de cuotas (amortización francesa). Antes de otorgar, evalúa el riesgo del cliente.",
    bloques: [
      {
        kind: "pasos",
        titulo: "Cómo se usa",
        pasos: [
          "Elegí el cliente (F3 lista todos).",
          "Definí el tipo de crédito. Para \"Productos\", elegís categoría → producto → cantidad y el capital = precio × cantidad (no mueve caja, descuenta stock).",
          "Ajustá monto, tasa, plazo y frecuencia; mirá el plan de cuotas y el panel de riesgo (semáforo).",
          "Elegí la cuenta de desembolso (efectivo / banco / dólares) y otorgá.",
          "Podés imprimir el \"Plan de pagos\" para el cliente.",
        ],
      },
      {
        kind: "definiciones",
        titulo: "Qué mira antes de otorgar",
        items: [
          { term: "Fondos de caja", desc: "No podés desembolsar más de lo que hay en la cuenta elegida de tu caja (admin: caja principal)." },
          { term: "Límite de otorgamiento", desc: "Un vendedor no puede superar su tope sin autorización de un admin." },
          { term: "Semáforo de riesgo", desc: "Evalúa capacidad de pago por sueldo, deuda vigente y —con plan Pro— bureaus. Puede bloquear o pedir autorización." },
          { term: "Tasa / plazo / monto", desc: "Deben respetar los rangos y plazos habilitados en Configuración → Simulador." },
        ],
      },
    ],
  },

  // ─────────────────────────────────────────── Pagos ───
  "/pagos": {
    titulo: "Pagos (cobro de cuotas)",
    resumen:
      "La terminal de cobro. Buscás al cliente, elegís su crédito y registrás el pago. El sistema imputa el dinero cuota por cuota automáticamente y actualiza la caja.",
    bloques: [
      {
        kind: "pasos",
        titulo: "Cómo se usa",
        pasos: [
          "Buscá al cliente por DNI o nombre (F3 lista todos) y abrí su ficha.",
          "Elegí el crédito a cobrar (si tiene más de uno, siempre se muestra el selector).",
          "El monto se autocompleta desde las cuotas seleccionadas; podés usar \"Monto personalizado\".",
          "Elegí el método (efectivo / transferencia / cheque) y confirmá. Se genera el recibo PDF.",
        ],
      },
      {
        kind: "definiciones",
        titulo: "Cómo se imputa",
        items: [
          { term: "Orden", desc: "Mora → Interés / Cargos → Capital, empezando por la cuota más vieja." },
          { term: "Cuenta de destino", desc: "El cobro entra a efectivo o banco según el método. El vendedor cobra a su caja; el admin, a la principal." },
          { term: "Sobrepago", desc: "No se puede cobrar más que la deuda total: el sistema lo rechaza indicando el máximo cobrable." },
          { term: "Anular un cobro", desc: "Un cobro cargado por error se anula desde el detalle del crédito (dentro del plazo configurado), con contra-asiento en la caja." },
        ],
      },
    ],
  },

  // ─────────────────────────────────────────── Cobranzas ───
  "/cobranza": {
    titulo: "Cobranzas y Recupero",
    resumen:
      "El centro de gestión de la mora. Organiza a quién contactar hoy, registra las gestiones, hace seguimiento de las promesas de pago y arma campañas de recuperación.",
    bloques: [
      {
        kind: "definiciones",
        titulo: "Las pestañas",
        items: [
          { term: "Hoy (agenda)", desc: "Cola priorizada de a quién contactar: promesas vencidas → agendados → morosos enfriados. Scopeada al vendedor." },
          { term: "Morosos", desc: "Créditos en mora con días e interés moratorio. Desde acá registrás gestiones (llamada, WhatsApp, visita…)." },
          { term: "Promesas", desc: "Seguimiento de promesas de pago (pendiente / cumplida / rota). Se concilian solas al cobrar; el cron rompe las vencidas." },
          { term: "Campañas", desc: "Envíos masivos a un grupo de morosos (Email/WhatsApp) con quita de interés opcional." },
        ],
      },
      {
        kind: "pasos",
        titulo: "Flujo típico",
        pasos: [
          "Arrancá por \"Hoy\": es la lista de trabajo del día.",
          "Registrá una gestión; si el cliente promete pagar, queda una promesa en seguimiento.",
          "Para varios casos a la vez, armá una campaña con su plantilla de mensaje.",
        ],
      },
      {
        kind: "tips",
        titulo: "Configuración relacionada",
        items: [
          "El umbral de \"morosos enfriados\" (cada cuántos días reaparecen) se ajusta en Configuración → Motor.",
        ],
      },
    ],
  },

  // ─────────────────────────────────────────── Caja ───
  "/caja": {
    titulo: "Caja",
    resumen:
      "El libro de movimientos de dinero de la financiera. Se cuadra sola con cada otorgamiento, cobro y anulación. Muestra el saldo por cuenta y permite ajustes, transferencias y arqueos.",
    bloques: [
      {
        kind: "definiciones",
        titulo: "Cómo funciona",
        items: [
          { term: "Cuentas", desc: "Efectivo, Banco y Dólares. El saldo total es solo pesos (efectivo + banco); los dólares van aparte, en USD, valorizados al blue." },
          { term: "Movimientos automáticos", desc: "Desembolso (al otorgar), cobro (al cobrar) y reversa (al anular) se registran solos." },
          { term: "Caja principal vs. del vendedor", desc: "Cada vendedor tiene su propia caja; la principal es la de tesorería (admin)." },
        ],
      },
      {
        kind: "pasos",
        titulo: "Acciones manuales",
        pasos: [
          "Ajuste: registrar un ingreso o egreso que no viene de un crédito (con descripción).",
          "Transferencia: mover saldo entre cuentas. Entre pesos y dólares es compra/venta con tipo de cambio.",
          "Arqueo: conciliar el saldo del sistema contra el conteo físico; la diferencia se ajusta.",
        ],
      },
      {
        kind: "tips",
        titulo: "Reglas de fondos",
        items: [
          "No se puede desembolsar, transferir ni ajustar en egreso por encima del saldo disponible: la caja nunca queda negativa.",
        ],
      },
    ],
  },

  // ─────────────────────────────────────────── Comprobantes ───
  "/comprobantes": {
    titulo: "Comprobantes",
    resumen:
      "El registro central de todos los comprobantes de caja (recibos, desembolsos, transferencias, arqueos…) de la caja principal y de las cajas de los vendedores, en una sola tabla filtrable.",
    bloques: [
      {
        kind: "pasos",
        titulo: "Cómo se usa",
        pasos: [
          "Filtrá por tipo, cuenta o rango de fechas.",
          "Cada comprobante tiene su número correlativo por serie (REC, DES, TRF…).",
          "Exportá a CSV para tu contabilidad.",
        ],
      },
    ],
  },

  // ─────────────────────────────────────────── Reportes ───
  "/reportes": {
    titulo: "Reportes",
    resumen:
      "El tablero financiero por pestañas. Analiza operaciones, rentabilidad, morosidad y efectividad de cobranza sobre el período que elijas. Solo administradores.",
    bloques: [
      {
        kind: "definiciones",
        titulo: "Las pestañas",
        items: [
          { term: "Resumen", desc: "KPIs del período: otorgado, cobrado, ingreso financiero, cartera y morosidad." },
          { term: "Operaciones", desc: "Evolución mensual de lo otorgado y ticket promedio." },
          { term: "Rentabilidad", desc: "Ingreso financiero − costo de fondeo = rentabilidad neta. Configurá el costo en Configuración → Rentabilidad." },
          { term: "Morosidad", desc: "Evolución de la mora reconstruida a fin de cada mes." },
          { term: "Cobranza", desc: "Efectividad de la gestión: embudo, recupero y desglose por canal y vendedor." },
        ],
      },
      {
        kind: "tips",
        titulo: "Exportar",
        items: ["Cada pestaña exporta a CSV su propio detalle."],
      },
    ],
  },

  // ─────────────────────────────────────────── Agentes ───
  "/personal": {
    titulo: "Agentes",
    resumen:
      "La gestión de tu equipo: cada agente tiene su ficha con rendimiento, comisiones, metas, logros y datos laborales. Al crear un agente se crea también su cuenta de acceso.",
    bloques: [
      {
        kind: "definiciones",
        titulo: "La ficha del agente",
        items: [
          { term: "Rendimiento", desc: "Créditos y monto otorgado, cartera, mora y evolución mensual." },
          { term: "Comisiones", desc: "Base, por tipo de crédito, escalonada por volumen y bonus por meta." },
          { term: "Metas", desc: "Objetivos por período (monto / cantidad / cobranza) con cumplimiento real." },
          { term: "Logros", desc: "Medallas, puntos y rango (gamificación configurable)." },
          { term: "Límite de otorgamiento", desc: "El tope que ese agente puede otorgar sin autorización." },
        ],
      },
      {
        kind: "tips",
        titulo: "Cuenta de acceso",
        items: [
          "Crear un agente exige crear su usuario (email + contraseña + rol).",
          "Los agentes viejos sin cuenta muestran \"Sin acceso\" con acción rápida para crearla.",
        ],
      },
    ],
  },

  // ─────────────────────────────────────────── Productos ───
  "/productos": {
    titulo: "Productos",
    resumen:
      "El inventario que vendés a crédito. En vez de prestar dinero, el cliente se lleva el producto y su precio se toma como capital. El control acá es el stock, no la caja.",
    bloques: [
      {
        kind: "pasos",
        titulo: "Cómo se usa",
        pasos: [
          "Cargá productos con su foto, categoría, precio y stock (más su stock mínimo para la alerta).",
          "Al otorgar un crédito de tipo \"Productos\", el precio del producto es el capital.",
          "Otorgar descuenta stock; anular o eliminar el crédito lo repone.",
        ],
      },
      {
        kind: "definiciones",
        titulo: "Stock auditable (kardex)",
        items: [
          { term: "El número de stock", desc: "Es un cache: no se edita a mano. Solo cambia por movimientos (entrada / ajuste) o por créditos." },
          { term: "Entrada / Ajuste", desc: "Desde la ficha del producto: reponer (entrada) o corregir con motivo (ajuste)." },
        ],
      },
    ],
  },
  "/productos/movimientos": {
    titulo: "Movimientos de stock",
    resumen:
      "El registro central del kardex: todos los movimientos de inventario de todos los productos en una sola tabla (análogo a Comprobantes para la caja).",
    bloques: [
      {
        kind: "pasos",
        titulo: "Cómo se usa",
        pasos: [
          "Filtrá por tipo (alta, entrada, venta, devolución, ajuste), fecha o texto.",
          "Cada fila muestra el producto, la cantidad con signo, el saldo resultante y el crédito vinculado si lo hay.",
          "Exportá a CSV.",
        ],
      },
    ],
  },

  // ─────────────────────────────────────────── Proveedores ───
  "/proveedores": {
    titulo: "Proveedores",
    resumen:
      "El registro de tus proveedores y sus movimientos de cuenta corriente (lo que les comprás y les pagás).",
    bloques: [
      {
        kind: "pasos",
        titulo: "Cómo se usa",
        pasos: [
          "Dá de alta un proveedor con sus datos de contacto.",
          "Registrá sus movimientos (compras y pagos) para llevar el saldo.",
        ],
      },
    ],
  },

  // ─────────────────────────────────────────── Usuarios ───
  "/usuarios": {
    titulo: "Usuarios",
    resumen:
      "Las cuentas de acceso al sistema (quién puede entrar y con qué rol). Distinto de Agentes: acá se gestiona el login; allá, la ficha comercial.",
    bloques: [
      {
        kind: "pasos",
        titulo: "Cómo se usa",
        pasos: [
          "Creá una cuenta con email, nombre de usuario (obligatorio y único), rol y contraseña.",
          "Cambiá el rol o activá/desactivá el acceso desde la lista.",
          "El botón 🔑 restablece la contraseña de un usuario.",
        ],
      },
      {
        kind: "definiciones",
        titulo: "Roles",
        items: [
          { term: "Admin", desc: "Ve y opera todo el sistema." },
          { term: "Vendedor", desc: "Otorga y cobra, pero ve solo sus propios créditos y su caja." },
          { term: "Nombre de usuario", desc: "Sirve como alias para loguear (además del email). Lo asigna el admin." },
        ],
      },
      {
        kind: "tips",
        titulo: "Seguridad",
        items: [
          "No podés quitarte tu propio rol de admin, desactivarte ni eliminar al único admin (evita quedar afuera).",
        ],
      },
    ],
  },

  // ─────────────────────────────────────────── Configuración ───
  "/configuracion": {
    titulo: "Configuración",
    resumen:
      "El motor de tu financiera. Definís cómo se calculan los créditos, qué ofrece el simulador, los canales de comunicación, la gamificación, la rentabilidad y la política de riesgo. Todo por pestañas.",
    bloques: [
      {
        kind: "definiciones",
        titulo: "Las pestañas",
        items: [
          { term: "Motor", desc: "Convención de tasa, mora (tasa diaria y base), orden de imputación y moneda. Además, el umbral de la agenda de cobranza." },
          { term: "Simulador", desc: "Rango de monto, tasa base y mín/máx, plazos habilitados, frecuencias, redondeo, cronograma y cargos (comisión, IVA, seguro, gastos)." },
          { term: "Comunicaciones", desc: "WhatsApp, SMS y Email: cada canal con su toggle y sus credenciales (los secretos nunca se muestran en claro)." },
          { term: "Gamificación", desc: "Período, pesos y umbrales de las medallas del equipo." },
          { term: "Rentabilidad", desc: "Costo de fondeo para calcular la rentabilidad neta de Reportes." },
          { term: "Riesgo / Originación", desc: "Política de aprobación (ratio cuota/ingreso, tope de créditos, bloqueo por mora, candado del sueldo) y bureaus (plan Pro)." },
        ],
      },
      {
        kind: "tips",
        titulo: "Cómo se guarda",
        items: [
          "Cada bloque tiene su propio botón Guardar: se pone sólido cuando hay cambios sin guardar y verde al confirmar.",
          "Los cambios de configuración NO afectan a los créditos ya otorgados: cada crédito congela sus reglas al nacer.",
        ],
      },
    ],
  },

  // ─────────────────────────────────────────── Auditoría ───
  "/auditoria": {
    titulo: "Auditoría",
    resumen:
      "La traza de todos los eventos de negocio del sistema: quién hizo qué y cuándo. Es solo lectura y sirve para control interno.",
    bloques: [
      {
        kind: "pasos",
        titulo: "Cómo se usa",
        pasos: [
          "Recorré los eventos (crear, actualizar, anular, registrar pago, cambiar config…).",
          "Cada evento registra el actor, la entidad afectada y un detalle. Nunca guarda contraseñas ni secretos.",
        ],
      },
    ],
  },

  // ─────────────────────────────────────────── Perfil ───
  "/perfil": {
    titulo: "Mi perfil",
    resumen: "Tus datos de cuenta. Desde acá cambiás tu nombre, tu email y tu contraseña.",
    bloques: [
      {
        kind: "pasos",
        titulo: "Cómo se usa",
        pasos: [
          "Editá tu nombre o email.",
          "Para cambiar la contraseña necesitás confirmar la actual (re-autenticación).",
        ],
      },
    ],
  },

  // ─────────────────────────────────────────── Plataforma (owner) ───
  "/plataforma": {
    titulo: "Panel de plataforma",
    resumen:
      "El panel del dueño del SaaS para administrar las financieras clientes: sus planes, vencimientos, montos y suspensiones. No opera ninguna financiera.",
    bloques: [
      {
        kind: "pasos",
        titulo: "Cómo se usa",
        pasos: [
          "Mirá los KPIs: total de financieras, en Pro, por vencer y suspendidas.",
          "Clic en una financiera abre su ficha: plan, vencimiento, monto mensual, notas e historial.",
          "Desde la ficha cambiás el plan (Pro/Free), suspendés/reactivás y editás el monto/notas.",
        ],
      },
    ],
  },

  // ─────────────────────────────────────────── Facturación ───
  "/facturacion": {
    titulo: "Plan y facturación",
    resumen:
      "El estado de tu suscripción a CreditFlow: qué plan tenés, cuándo vence y qué features incluye.",
    bloques: [
      {
        kind: "definiciones",
        titulo: "Qué ves",
        items: [
          { term: "Plan", desc: "Free o Pro. El plan Pro habilita features premium como la verificación en bureaus (BCRA/Nosis/Veraz)." },
          { term: "Vencimiento", desc: "La fecha hasta la que está paga tu suscripción; el sistema te avisa cuando está por vencer." },
        ],
      },
    ],
  },
};

/**
 * Resuelve el documento de ayuda para una ruta. Match exacto primero, luego prefijos cada vez
 * más cortos (así `/creditos/nuevo` cae en `/creditos` si no tiene entrada propia). Devuelve
 * null si la sección no tiene ayuda (el botón "?" se oculta).
 */
export function getHelpDoc(pathname: string): HelpDoc | null {
  if (HELP[pathname]) return HELP[pathname];
  const parts = pathname.split("/").filter(Boolean);
  for (let i = parts.length - 1; i > 0; i--) {
    const key = "/" + parts.slice(0, i).join("/");
    if (HELP[key]) return HELP[key];
  }
  return null;
}
