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
          { term: "Refinanciar", desc: "Solo créditos en mora: consolida la deuda viva (capital + interés + cargos + mora) en un crédito nuevo, con quita opcional. No mueve caja: la deuda se traslada." },
        ],
      },
      {
        kind: "pasos",
        titulo: "Refinanciar / reestructurar deuda",
        pasos: [
          "Entrá a la pestaña \"Refinanciados\": buscá el crédito en mora por N°, DNI o nombre y tocá \"Refinanciar\".",
          "También podés hacerlo desde el detalle de un crédito moroso (botón \"Refinanciar\" arriba a la derecha).",
          "En el diálogo ves la deuda viva a consolidar; podés renegociar tasa/plazo y aplicar una quita (%, monto o ninguna).",
          "Al confirmar, el crédito viejo queda \"refinanciado\" (saldo $0) y nace uno nuevo con la deuda consolidada.",
        ],
      },
      {
        kind: "tips",
        titulo: "La pestaña Refinanciados",
        items: [
          "Arriba muestra KPIs de recupero: cuántas refinanciaciones están al día (se pagan) vs. cuántas volvieron a mora.",
          "El buscador lista los créditos en mora candidatos, con acción directa para refinanciar cada uno.",
          "En el historial, \"Comparar\" abre el antes → después: el plan de cuotas y la TNA del crédito original vs. la refinanciación.",
          "Un crédito marcado \"re-refi\" ya proviene de otra refinanciación: ojo con encadenar reestructuraciones.",
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
          { term: "Vendedor", desc: "Define de qué caja sale el desembolso: elegir a alguien lo descuenta de SU caja; dejarlo en «La financiera» lo descuenta de la caja principal. No es obligatorio — el dueño también vende. Un vendedor no elige: el sistema le asigna su propia ficha." },
          { term: "Fondos de caja", desc: "No podés desembolsar más de lo que hay en la cuenta elegida de tu caja (admin: caja principal)." },
          { term: "Límite de otorgamiento", desc: "Un vendedor no puede superar su tope sin autorización de un admin." },
          { term: "Semáforo de riesgo", desc: "Evalúa capacidad de pago por sueldo, deuda vigente y —con plan Pro— bureaus. Puede bloquear o pedir autorización." },
          { term: "Tasa / plazo / monto", desc: "Deben respetar los rangos y plazos habilitados en Configuración → Simulador." },
        ],
      },
      {
        // El recuadro naranja del simulador. Cada dato que muestra, explicado — el usuario
        // pidió esta sección después de no entender qué significaba cada número.
        kind: "definiciones",
        titulo: "El recuadro de Originación",
        items: [
          {
            term: "Semáforo (Aprobado / Revisar / Rechazado)",
            desc: "El veredicto. Aprobado: entra sin observaciones. Revisar: se puede otorgar pero hay algo que mirar (por ejemplo, cliente sin historial). Rechazado: no califica; según la configuración, se bloquea o pide autorización de un admin.",
          },
          {
            term: "Monto máximo sugerido",
            desc: "El capital más grande que este cliente puede pagar con su sueldo, a la tasa y el plazo que estás cargando. El botón «Usar» lo carga en el campo Capital. Cambia con el plazo: más cuotas → cuota más chica → mayor monto posible.",
          },
          {
            term: "Cuota máx (capacidad)",
            desc: "Cuánto puede destinar por mes: su ingreso × el porcentaje configurado en Riesgo, menos lo que ya paga por otros créditos. Con $450.000 de ingreso y un tope del 30%, son $135.000. Es el número del que sale el monto sugerido.",
          },
          {
            term: "Ratio cuota / ingreso",
            desc: "Qué porcentaje del sueldo se lleva la cuota del crédito que estás simulando, sumada a lo que ya paga. Mientras esté por debajo del tope configurado, la capacidad de pago está bien.",
          },
          {
            term: "Score interno",
            desc: "Cómo se portó el cliente EN ESTA financiera (pagos puntuales, atrasos). «Sin historial» es un cliente nuevo: no es malo, es que todavía no hay con qué juzgarlo.",
          },
          {
            term: "«Puede afrontar más, pero el máximo que podés otorgar es…»",
            desc: "Aparece cuando el cliente aguanta más de lo que podés prestarle, sea por el máximo de la financiera o por tu propio límite de otorgamiento. El monto sugerido sigue mostrando su capacidad real —conviene saber que te sobra margen— pero «Usar» carga hasta donde el sistema te deja.",
          },
        ],
      },
      {
        kind: "tips",
        titulo: "Cómo se calcula el monto sugerido",
        items: [
          "Sale de la capacidad de pago, no de un porcentaje del monto pedido: se busca el capital cuya cuota sea exactamente lo que el cliente puede pagar por mes.",
          "La frecuencia importa. Con cuotas semanales el cliente paga 52 veces al año, no 12: el sistema lo lleva a su equivalente mensual antes de compararlo con el sueldo.",
          "Los cargos cuentan. Si tenés IVA, seguro o gastos activos, el sugerido baja: son plata que el cliente también paga.",
          "Los créditos que ya tiene descuentan. Si Nora ya paga $40.000 por mes, le quedan $95.000 de margen en vez de $135.000.",
          "Es orientativo, no una aprobación: podés escribir otro monto. Lo que cambia es el semáforo, y todo se vuelve a validar en el servidor al otorgar.",
        ],
      },
      {
        kind: "definiciones",
        titulo: "La barra de resultados (al pie del plan)",
        items: [
          { term: "Cuota", desc: "Lo que paga el cliente en cada vencimiento. Si tenés cargos activos dice «c/cargos»: ya incluye IVA, seguro y gastos." },
          { term: "Intereses", desc: "Lo que la financiera gana por prestar, sumado a lo largo de todo el plan. No incluye los cargos." },
          { term: "Total a pagar", desc: "Todo lo que el cliente va a desembolsar: capital + intereses + cargos." },
          { term: "T.E.A.", desc: "Tasa Efectiva Anual. El costo del INTERÉS llevado a un año. No incluye IVA, seguro, gastos ni comisión." },
          {
            term: "C.F.T.",
            desc: "Costo Financiero Total: lo que el crédito le cuesta al cliente con TODO adentro (interés + IVA + seguro + gastos + comisión), expresado como tasa anual. Es el único número que compara dos ofertas de verdad. Si no hay cargos activos, da igual que la T.E.A.; si hay, siempre da más alto. Va también en el plan de pagos que se le entrega al cliente.",
          },
          { term: "Cargos totales", desc: "La suma en pesos de IVA, seguro, gastos y comisión de todo el plan. Aparece solo si tenés algún cargo activo." },
          { term: "Capital / Interés", desc: "La barra de abajo: qué proporción del total a pagar es la plata prestada y qué proporción es la ganancia." },
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
      "El centro de gestión de la mora. Organiza a quién contactar hoy, registra las gestiones, hace seguimiento de las promesas de pago, arma campañas de recuperación e imprime la planilla del cobrador de calle.",
    bloques: [
      {
        kind: "definiciones",
        titulo: "Las pestañas",
        items: [
          { term: "Hoy (agenda)", desc: "Cola priorizada de a quién contactar: promesas vencidas → agendados → morosos enfriados. Scopeada al vendedor." },
          { term: "Morosos", desc: "Créditos en mora con días e interés moratorio. Desde acá registrás gestiones (llamada, WhatsApp, visita…)." },
          { term: "Promesas", desc: "Seguimiento de promesas de pago (pendiente / cumplida / rota). Se concilian solas al cobrar; el cron rompe las vencidas." },
          { term: "Acuerdos", desc: "Los planes de pago vigentes, cumplidos y rotos. El sistema los evalúa solo: no hay que marcarlos a mano." },
          { term: "Campañas", desc: "Envíos masivos a un grupo de morosos (Email/WhatsApp) con quita de interés opcional." },
      { term: "No contactar", desc: "Si el cliente pide que no lo llamen, se registra desde su ficha. Deja de recibir mensajes y sale de la agenda, pero la deuda sigue viva y se le puede cobrar. Levantarlo solo lo puede hacer un admin." },
        ],
      },
      {
        kind: "pasos",
        titulo: "Flujo típico",
        pasos: [
          "Arrancá por \"Hoy\": es la lista de trabajo del día.",
          "Registrá una gestión; si el cliente promete pagar, queda una promesa en seguimiento.",
          "Si prometió y no pagó, subí un escalón: ofrecele un acuerdo sobre lo vencido.",
          "Para varios casos a la vez, armá una campaña con su plantilla de mensaje.",
        ],
      },
      {
        kind: "pasos",
        titulo: "Armar una campaña",
        pasos: [
          "En Morosos, elegí a quién: filtrá por severidad (Crítica, Alta) o tildá clientes uno por uno.",
          "Botón «Nueva campaña»: el número que muestra es sobre cuántos va a trabajar. Sin nada tildado, toma los que estás viendo.",
          "Elegí canal y escribí el mensaje. Los datos entre corchetes —[Nombre], [Monto]— se reemplazan por los de cada cliente.",
          "Opcional: quita de interés de mora, como incentivo para que paguen ahora.",
          "Enviar. Va por tandas y muestra el avance; si se corta, volvés a apretar y sigue por donde quedó, sin repetirle a nadie.",
        ],
      },
      {
        // La cobranza de calle es la otra mitad del trabajo y no vivía en el sistema: el
        // cobrador no lo usa, así que su herramienta es un papel. Va acá porque el botón
        // está en Morosos y no se descubre solo.
        kind: "pasos",
        titulo: "Salir a cobrar a la calle",
        pasos: [
          "En Morosos, botón «Planilla de calle»: arma el recorrido y lo imprime.",
          "Elegí las zonas. La zona sale de la ficha del cliente; los que no la tienen cargada van juntos en un grupo aparte.",
          "«A quién visitar»: solo los vencidos, o también los que vencen dentro de 7, 15 o 30 días —el recorrido de rutina.",
          "Antes de imprimir ves cuántos clientes y cuánta plata tiene el recorrido, zona por zona.",
          "Cada zona sale en una hoja, ordenada por domicilio, con dos casilleros vacíos por cliente: lo cobrado y la firma.",
          "Al pie hay una rendición para que el cobrador cierre lo que trae.",
        ],
      },
      {
        // La vuelta del circuito. Sin esto la planilla es una lista que sale y no vuelve.
        kind: "pasos",
        titulo: "Cuando el cobrador vuelve",
        pasos: [
          "Pestaña «Planillas»: ahí está cada recorrido que salió, con lo que ya se cobró de él.",
          "Abrí la planilla y cargá los cobros renglón por renglón, con el papel al lado. Cada uno se registra como un pago normal: imputa, mueve caja y emite comprobante.",
          "Un cobro parcial deja el resto pendiente en su renglón, así se ve de un vistazo qué falta.",
          "«Rendir planilla»: contás el efectivo que entregó y el sistema lo compara con lo cargado.",
          "Si no coincide, hay que explicar por qué antes de cerrar. Al cerrarse, la planilla no admite más cobros.",
        ],
      },
      {
        kind: "tips",
        titulo: "Qué significa la diferencia de una rendición",
        items: [
          "Se compara lo que ENTREGÓ contra lo CARGADO en el sistema, no contra lo que salió a cobrar.",
          "Que traiga menos de lo que salió a cobrar es normal: hay gente que no estaba y pagos parciales. Eso no es una diferencia.",
          "Faltante: trajo menos de lo que figura cobrado. O falta anular un cobro mal cargado, o falta plata.",
          "Sobrante: trajo más de lo que figura cobrado. Casi siempre son cobros del papel que todavía no se cargaron.",
          "Rendir es solo del admin: quien maneja efectivo ajeno no firma su propio faltante.",
        ],
      },
      {
        kind: "tips",
        titulo: "La planilla de calle, en detalle",
        items: [
          "Los importes son los del día que se imprime: la mora corre por día, así que una planilla vieja pide de menos. El importe final lo fija el sistema al registrar el pago.",
          "Un cliente con tres créditos son tres renglones —cada uno con su importe y su recibo—, pero quedan pegados porque la lista se ordena por domicilio.",
          "No entran los que están cumpliendo un acuerdo de pago, ni los que pidieron no ser contactados: una visita a domicilio es un contacto.",
          "Incluye a los que ya fueron gestionados hoy por teléfono, a diferencia de la agenda: el recorrido se organiza por barrio, no por quién llamó a quién.",
          "El vendedor imprime solo su cartera; el admin, toda la financiera.",
        ],
      },
      {
        kind: "tips",
        titulo: "Lo que la campaña NO manda",
        items: [
          "Créditos ya refinanciados o saldados: su deuda está en otro lado y reclamarla sería cobrar dos veces.",
          "Clientes fallecidos: quedan con el casillero apagado y su deuda en revisión.",
          "El importe que se reclama es lo VENCIDO con mora, no el préstamo entero: es lo mismo que le va a cobrar la caja.",
        ],
      },
      {
        // Los tres instrumentos se confunden todo el tiempo, y elegir mal cuesta plata: la
        // refinanciación no se deshace. Van en orden de menor a mayor compromiso.
        kind: "definiciones",
        titulo: "Las tres formas de recuperar a un moroso",
        items: [
          {
            term: "1 · Promesa de pago",
            desc:
              "\"Pagame el viernes\". No modifica nada: la deuda es la misma, las cuotas siguen en su fecha y los punitorios siguen corriendo. Queda anotada con fecha y, si no cumple, el sistema la marca rota solo y te avisa. Para el que se olvidó o cobra el día 10.",
          },
          {
            term: "2 · Acuerdo de pago",
            desc:
              "Toma SOLO lo vencido y lo reparte en cuotas. El crédito sobrevive: lo que todavía no venció sigue su curso normal. Mientras cumple no se le devengan más punitorios y sale de la lista de morosos. Si lo rompe, vuelve todo como estaba. Para el que puede pagar, pero no todo junto.",
          },
          {
            term: "3 · Refinanciación",
            desc:
              "Cierra el crédito y crea uno nuevo con TODA la deuda —vencida y por vencer— y cronograma desde cero. No se deshace, y le descuenta 25 puntos de score al cliente. Para el que ya no puede con el crédito que firmó.",
          },
        ],
      },
      {
        kind: "pasos",
        titulo: "Cómo se arma un acuerdo",
        pasos: [
          "Entrá al crédito en mora y elegí \"Acuerdo de pago\". Arriba vas a ver lo que se toma: capital vencido, interés de esas cuotas y punitorios corridos.",
          "Elegí en cuántas cuotas y cuándo vence la primera. El tope de cuotas y cada cuántos días vencen se fijan en Configuración → Cobranza.",
          "Si querés dar un incentivo, cargá una condonación. Sale de los punitorios y el interés, NUNCA del capital, y cada vendedor tiene su propio tope.",
          "Confirmá. El crédito sale de la agenda del día y los punitorios dejan de correr mientras cumpla.",
        ],
      },
      {
        kind: "texto",
        titulo: "Qué gana y qué pierde cada uno",
        parrafos: [
          "EL DEUDOR gana tres cosas concretas: paga en cuotas en vez de todo junto, deja de acumular punitorios mientras cumple, y sale de la lista de morosos. Sobre una deuda vencida de $74.000 con mora al 0,1% diario, congelar los punitorios le ahorra unos $2.200 por mes.",
          "LA FINANCIERA gana lo único que importa cuando alguien ya no paga: cobrar. Un acuerdo cumplido recupera el 100% de lo vencido sin gestión judicial, sin quita y sin perder al cliente. Y si se rompe, no perdiste nada: el crédito vuelve exactamente como estaba y los punitorios corren de nuevo desde el vencimiento original.",
          "EL INTERÉS DEL ACUERDO lo define cada financiera en Configuración → Cobranza. Si el campo queda vacío, el acuerdo lleva la MISMA tasa que el cliente firmó: paga por la plata el mismo precio de siempre, y su beneficio real es que los punitorios dejan de correr. Ese es el equilibrio — ninguno de los dos gana ni pierde por el atraso. Si en cambio se pone 0, el acuerdo no lleva interés: sobre una deuda de $74.000 a tres meses la financiera resigna unos $7.500, y atrasarse pasa a convenirle al deudor, porque se lleva meses de plazo gratis.",
          "Y OJO CON EL CALENDARIO: el acuerdo toma solo lo vencido, así que las cuotas que todavía no vencieron siguen corriendo en su fecha. Al deudor le puede quedar un mes con la cuota original MÁS la del acuerdo. Antes de ofrecer un plan, mirá que el total mensual le entre.",
        ],
      },
      {
        kind: "tips",
        titulo: "Cuándo se rompe, y qué pasa después",
        items: [
          "Con una sola cuota impaga el acuerdo se cae (es configurable). No hace falta que nadie lo marque: el sistema lo evalúa todos los días.",
          "Al romperse, el crédito vuelve a morosos y los punitorios se recalculan desde el vencimiento ORIGINAL, no desde que se rompió el acuerdo.",
          "Un acuerdo roto le descuenta 10 puntos de score al cliente. Una promesa incumplida, 4.",
          "Un crédito puede tener un solo acuerdo vigente por vez. Para armar otro hay que cerrar el anterior.",
        ],
      },
      {
        kind: "tips",
        titulo: "Configuración relacionada",
        items: [
          "Configuración → Cobranza: cada cuántos días reaparece un moroso sin gestionar, el tope de cuotas del acuerdo, qué lo rompe y cuánto puede condonar un vendedor.",
          "Configuración → Cobranza → Escalera de recupero: si querés obligar a subir los escalones en orden (no refinanciar sin haber intentado un acuerdo antes). De fábrica está apagado.",
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
        // Los cinco botones de "Acciones de caja". El texto vive acá y NO adentro del botón:
        // un botón se lee de un vistazo, y cinco párrafos en fila lo convertían en una ficha.
        // Van en el mismo orden que en pantalla, que es el orden real de uso.
        kind: "definiciones",
        titulo: "Acciones de caja",
        items: [
          { term: "Capital", desc: "La plata que el dueño pone o retira del negocio." },
          { term: "Caja de vendedores", desc: "Entregar plata a un vendedor o recibir lo que rinde." },
          { term: "Transferir", desc: "Pasar saldo entre efectivo, banco y dólares. Entre pesos y dólares es compra/venta, con su tipo de cambio." },
          { term: "Arqueo", desc: "Contar lo que hay y dejar constancia de cómo cerró." },
          { term: "Ajuste", desc: "Corregir un error de registro. No sirve para cargar capital." },
        ],
      },
      {
        // Los dos roles entran por la misma ruta y ven esta misma ayuda, pero cada uno tiene
        // su barra: el vendedor no dispone de capital ni de la caja de los demás.
        kind: "definiciones",
        titulo: "Acciones de caja (vendedor)",
        items: [
          { term: "Rendir efectivo", desc: "Entregarle a la caja principal la plata que cobraste. Es lo que más vas a usar." },
          { term: "Transferir", desc: "Pasar saldo entre tus propias cuentas: efectivo, banco y dólares." },
          { term: "Registrar gasto", desc: "Un egreso de tu caja que no es un crédito ni una rendición." },
          { term: "Cerrar caja", desc: "Contás lo que tenés y lo declarás. Si hay diferencia, tu saldo NO se toca: queda pendiente hasta que un administrador la revise." },
        ],
      },
      {
        kind: "definiciones",
        titulo: "Capital del dueño",
        items: [
          { term: "Aporte de capital", desc: "Plata que ponés vos para prestar. Suma a la caja, pero NO es una ganancia del negocio: la financiera no ganó nada, solo tiene más con qué trabajar." },
          { term: "Retiro de utilidades", desc: "Plata que sacás del negocio. Resta de la caja, pero NO es un gasto. No podés retirar más de lo que hay disponible." },
          { term: "Por qué está separado del ajuste", desc: "El ajuste corrige un error de registro. Si un aporte se cargara como ajuste, en el libro un aporte de $10.000.000 se leería igual que una corrección de $1.500, y para distinguirlos habría que leer la descripción a mano." },
          { term: "Comprobante propio", desc: "Los aportes llevan serie APO y los retiros RET, con su numeración. Sirven para respaldar el movimiento ante tu contador." },
        ],
      },
      {
        kind: "definiciones",
        titulo: "Cierres de caja (arqueos)",
        items: [
          { term: "Queda asentado siempre", desc: "Cada cierre se guarda aunque cuadre exacto: es el comprobante de que la caja se cerró ese día." },
          { term: "Sobrante y faltante", desc: "Sobrante = hay más plata que la que dice el sistema. Faltante = hay menos. El faltante es el que conviene mirar de cerca." },
          { term: "El vendedor cierra su caja", desc: "Con el botón «Cerrar caja» declara lo que contó. Si hay diferencia, el sistema NO la ajusta solo: queda pendiente y su saldo no se modifica. Si pudiera ajustarla él mismo, tendría un botón para hacer desaparecer la plata que falta." },
          { term: "El administrador concilia", desc: "Al conciliar un cierre pendiente se registra el ajuste en la caja de esa persona y el saldo de sistema pasa a coincidir con lo contado. Pide un motivo obligatorio, que queda en el libro." },
          { term: "Arqueo de la caja principal", desc: "El administrador arquea su propia tesorería y la diferencia se ajusta en el momento: es el dueño de esa caja." },
        ],
      },
      {
        kind: "tips",
        titulo: "Reglas de fondos",
        items: [
          "No se puede desembolsar, transferir ni ajustar en egreso por encima del saldo disponible: la caja nunca queda negativa.",
          "Un cierre con diferencia no bloquea a nadie: el vendedor sigue trabajando y la diferencia queda a la vista hasta que la resuelvas.",
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

  // ─────────────────────────────────────────── Comisiones ───
  "/comisiones": {
    titulo: "Comisiones",
    resumen:
      "Acá liquidás lo que le debés a cada agente por su trabajo del período. Al liquidar, el monto queda congelado con el detalle de qué crédito aportó cuánto, y la plata sale de la caja principal. Es el respaldo de lo que pagaste: si mañana cambiás un porcentaje, este pago no se altera.",
    bloques: [
      {
        kind: "pasos",
        titulo: "Cómo liquidar un período",
        pasos: [
          "Elegí la duración (mensual, trimestral, semestral o anual) y el período. Arranca en el mes en curso.",
          "La tabla muestra, por agente, cuánto otorgó, cuántos créditos y cuánto le corresponde de comisión.",
          "Hacé clic en la fila del agente para ver el detalle: qué crédito aportó cuánto y con qué porcentaje.",
          "Presioná «Liquidar», elegí de qué cuenta sale la plata (efectivo, banco o dólares) y confirmá.",
          "Queda emitido un comprobante LIQ y el egreso aparece en Caja y en Comprobantes.",
        ],
      },
      {
        kind: "definiciones",
        titulo: "Qué significa cada columna",
        items: [
          { term: "Otorgado", desc: "Lo que el agente colocó dentro del período. Es la base del cálculo. No incluye créditos anulados ni refinanciaciones (una refinanciación no es plata nueva)." },
          { term: "A pagar", desc: "La comisión por sus créditos más el bonus por meta, si corresponde." },
          { term: "Bonus", desc: "El premio por cumplir la meta. Solo se paga si la meta vigente cubre exactamente el período que estás liquidando." },
          { term: "Pendiente", desc: "Todavía no se le pagó ese período." },
          { term: "LIQ-000001", desc: "Ya está liquidado. El número es el comprobante; hacé clic para ver cómo se calculó." },
        ],
      },
      {
        kind: "tips",
        titulo: "Cosas para tener en cuenta",
        items: [
          "Un agente no puede cobrar dos veces el mismo período: el sistema lo bloquea, y también bloquea liquidar fechas que se pisen con una liquidación anterior.",
          "Si el bonus aparece en cero, revisá el detalle: ahí se explica el motivo. Lo más común es que la meta sea de otro período (por ejemplo, anual) y el bonus se pague cuando liquides ese período completo.",
          "Si te equivocaste, no se edita: se anula. Anular devuelve la plata a la caja con un movimiento inverso y deja el registro marcado, con el motivo. Después podés volver a liquidar.",
          "El porcentaje de comisión de cada agente se configura en su ficha, en Equipo → la persona → pestaña Comisiones.",
          "Cada vendedor puede ver sus propias liquidaciones desde su inicio de sesión, con el mismo detalle. No puede modificar nada.",
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

  // ─────────────────────────────────────────── Equipo ───
  "/equipo": {
    titulo: "Equipo",
    resumen:
      "Todas las personas de la financiera en una sola lista, con sus dos caras: la cuenta con la que entran al sistema y su ficha de agente (comisiones, metas, caja). Reemplaza a las viejas secciones Usuarios y Agentes: acá se hace todo.",
    bloques: [
      {
        kind: "definiciones",
        titulo: "Las dos caras de una persona",
        items: [
          { term: "Cuenta de acceso", desc: "Si puede entrar al sistema, con qué rol y si está activa. Es la llave." },
          { term: "Ficha del agente", desc: "A quién se le atribuye cada crédito, su comisión, su meta y su caja. Es el historial." },
          { term: "Por qué van separados", desc: "Si un empleado se va y le cerrás el acceso, sus créditos y comisiones tienen que seguir existiendo. Por eso la ficha sobrevive a la cuenta." },
        ],
      },
      {
        kind: "definiciones",
        titulo: "Los tres casos que vas a ver",
        items: [
          { term: "Cuenta + ficha", desc: "Lo normal en un vendedor: entra al sistema y otorga créditos." },
          { term: "Solo cuenta", desc: "Alguien que entra pero no vende — por ejemplo, el administrador de la financiera." },
          { term: "Sin cuenta", desc: "Una ficha sin acceso. Son agentes viejos, de antes de que el alta exigiera crear la cuenta." },
        ],
      },
      {
        kind: "pasos",
        titulo: "Cómo se usa",
        pasos: [
          "\"Nuevo integrante\" es la única forma de dar de alta a alguien. Lo que se crea depende del \"Rol de acceso\" que elijas: Vendedor → su ficha de agente y su cuenta; Administrador → solo la cuenta, porque no vende.",
          "Hacé click en una persona para abrir su ficha: rendimiento, comisiones, metas, logros y datos laborales.",
          "Desde la lista cambiás su cuenta: editar, restablecer la contraseña (🔑), activar/desactivar el acceso o eliminar.",
          "A quien figure \"Sin cuenta\" le podés crear el acceso con el botón que aparece en su fila.",
        ],
      },
      {
        kind: "definiciones",
        titulo: "Qué hay en la ficha del agente",
        items: [
          { term: "Rendimiento", desc: "Créditos y monto otorgado, cartera, mora y evolución mensual." },
          { term: "Comisiones", desc: "Base, por tipo de crédito, escalonada por volumen y bonus por meta." },
          { term: "Metas", desc: "Objetivos por período (monto / cantidad / cobranza) con cumplimiento real." },
          { term: "Logros", desc: "Medallas, puntos y rango (gamificación configurable)." },
          { term: "Límite de otorgamiento", desc: "El tope que ese agente puede otorgar sin autorización." },
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
        titulo: "Cosas que conviene saber",
        items: [
          "El nombre de cada persona se edita en Mi perfil y desde acá; se actualiza en los dos lados a la vez.",
          "El resto de los datos personales (celular, domicilio, nacimiento) los edita cada uno en su Mi perfil.",
          "Desactivar el acceso NO borra nada: la ficha y todo el historial quedan intactos.",
          "Eliminar a alguien con ficha te pregunta aparte si querés borrar también su login. Si lo conservás, ese email queda ocupado y no lo vas a poder reutilizar.",
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
