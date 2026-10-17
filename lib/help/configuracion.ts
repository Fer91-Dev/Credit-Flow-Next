/**
 * Ayuda de cada bloque de Configuración (el "?" de cada sección): qué configura y con qué
 * efecto. Vive aparte del formulario para que la lean dos consumidores: `ConfigForm` (el globo
 * del "?") y `scripts/generar-manual.mts` (el manual en PDF de la Ayuda). Un solo texto: el
 * manual no puede decir otra cosa que la pantalla.
 *
 * `ejemplo` es un caso resuelto con números. Va aparte de `puntos` porque explicar un
 * parámetro por definición no muestra la mecánica; un caso con plata sí.
 *
 * `opciones`: qué hace CADA control del bloque, en pares opción → efecto.
 */
export type AyudaBloque = { titulo?: string; texto: string; ejemplo?: string; puntos?: string[]; opciones?: { opcion: string; efecto: string }[] };

export const AYUDA: Record<string, AyudaBloque> = {
  motor: {
    titulo: "Motor financiero",
    texto: "Define cómo el sistema interpreta la tasa que cargás en cada crédito y con qué método arma las cuotas.",
    puntos: [
      "Convención de tasa: si el número que escribís es anual (TNA/TEA) o mensual.",
      "Sistema de amortización: hoy Francés (cuota fija todos los períodos).",
    ],
  },
  tramosMora: {
    titulo: "Tramos de mora",
    texto:
      "La escala de gravedad de un moroso según sus días de atraso. No cambia lo que se le cobra: " +
      "cambia cómo se lo clasifica en el Home, en Reportes y en la agenda del día.",
    puntos: [
      "Media / Alta / Crítica: los dos números definen los tres tramos.",
      "Es una decisión de la financiera: quien presta a 30 días considera grave a la semana, quien presta a un año recién a los 90.",
      "Los valores de fábrica (15 y 30) son los que el sistema venía usando: cambiarlos no reescribe nada, solo mueve la clasificación.",
    ],
  },
  mora: {
    titulo: "Interés por mora",
    texto:
      "Recargo que se suma cuando el cliente paga una cuota tarde. Se calcula POR CUOTA y sobre el valor de esa cuota: "
      + "si tiene tres vencidas, cada una devenga su propio punitorio. Con el switch apagado no se cobra mora.",
    ejemplo:
      "Una cuota de $50.000,00 con mora del 1% diario acumula $500,00 por día. A los 30 días de atraso son $15.000,00; "
      + "a los 100 días, $50.000,00 — o sea, la mora ya iguala a la cuota. Sin tope sigue: al año son $182.500,00 de "
      + "punitorios sobre una cuota de $50.000,00. Con el tope en «1 vez el valor de la cuota», se detiene en $50.000,00 "
      + "y no crece más, aunque el crédito quede impago dos años.",
    puntos: [
      "Tasa diaria: % que se acumula por cada día de atraso.",
      "Los días de gracia (Simulador → Cronograma) son la tolerancia antes de que empiece a correr.",
      "TOPE — hasta dónde puede crecer la mora DE CADA CUOTA. NO cuenta cuotas vencidas: limita el importe a un múltiplo de lo que vale la cuota.",
      "Elegirlo resigna plata: en un cliente que paga muy tarde vas a cobrar menos punitorios de los que se habrían acumulado.",
      "A cambio, la deuda sigue siendo pagable. Cuando los punitorios triplican la cuota, el deudor deja de intentar y el caso se pierde entero.",
      "Y los reportes dejan de mentir: hoy el saldo expuesto y el % de morosidad incluyen punitorios que nadie va a pagar.",
      "Si el caso va a juicio, el art. 771 del Código Civil faculta al juez a reducir intereses excesivos. Un tope propio es defendible; uno impuesto por un juez, no.",
      "El tope se CONGELA al otorgar, igual que la tasa: cambiarlo no reescribe la deuda de los créditos ya dados.",
    ],
  },
  cajas: {
    titulo: "Control de las cajas",
    texto:
      "Cada vendedor tiene su propia caja: ahí entra lo que cobra y de ahí sale lo que rinde. La tuya es la caja principal. " +
      "Estos dos números definen qué puede hacer alguien con la plata sin pedirte permiso.",
    puntos: [
      "Gastos del vendedor: si puede descontar gastos de su caja por su cuenta — no puede, hasta un monto por gasto, o sin tope.",
      "Días para anular un cobro: la ventana para deshacer un pago cargado por error. Después queda firme.",
      "El cierre de turno no se configura: cada caja cierra con su acta (contado, diferencia, retiro y fondo). La diferencia de un vendedor queda declarada y la conciliás vos; la de la caja principal se ajusta en el acto.",
    ],
    ejemplo:
      "El gasto en 0 (como viene) es a propósito. Todas las noches el vendedor cierra su caja: cuenta la plata y el sistema " +
      "compara con lo que debería tener. Si falta, queda pendiente y lo resolvés vos con un motivo escrito. Si pudiera " +
      "anotar gastos solo, a uno al que le faltan $80.000 le alcanzaría con escribir «combustible $80.000» para que esa " +
      "noche le cierre cuadrado y el faltante no aparezca nunca. Si le querés dar caja chica para nafta o viáticos, " +
      "ponele el techo que te parezca: por encima de ese número, el gasto lo cargás vos desde la caja principal. " +
      "«Sin tope» también se puede: cada gasto te llega a la campanita y sale en el cierre de turno, pero ahí lo " +
      "tenés que mirar vos, porque el arqueo no lo marca como diferencia.",
  },
  escalera: {
    titulo: "Refinanciaciones",
    texto:
      "Cuando alguien se atrasa hay tres formas de recuperarlo, de la más blanda a la más definitiva: " +
      "la promesa de pago (un compromiso verbal, no toca nada), el acuerdo (reparte lo vencido en cuotas y el " +
      "crédito sobrevive) y la refinanciación (cierra el crédito y nace otro con toda la deuda). " +
      "Acá decidís si hay que subir los escalones en orden o si el vendedor resuelve como pueda.",
    puntos: [
      "De fábrica está todo apagado: se puede ir directo a cualquiera de los tres.",
      "Los mínimos de atraso evitan refinanciar a alguien por tres días de demora.",
      "El mínimo para refinanciar puede además CERRAR el cobro: pasado ese atraso el plan viejo se da por caído y la terminal lo rechaza, así la deuda se recalcula y se aplican los honorarios de gestión.",
      "Ese corte respeta lo que ya está en marcha: un acuerdo vigente se sigue cobrando, y la entrega con la que se arma uno nuevo también entra.",
      "Los honorarios de gestión se configuran como una BANDA (mínimo y máximo), no como un número: el porcentaje se pacta al refinanciar, con el cliente enfrente. Con mínimo igual a máximo queda fijo.",
      "La TASA del plan nuevo tiene su propia banda, y los PLAZOS su propia lista: refinanciar y prestar plata nueva no son el mismo producto. Vacíos, rigen los del Simulador.",
      "El monto NO tiene tope al refinanciar: el capital es la deuda que el cliente ya tiene, no una decisión comercial. Ponerle el techo de otorgamiento impedía reestructurar justo las deudas grandes.",
      "Las condiciones del ACUERDO (a los cuántos días pasa a Legales, cuántos acuerdos rotos se admiten, si hay que contactarlo antes) están en el bloque Acuerdos de pago.",
      "Exigir el acuerdo antes de refinanciar es la regla fuerte: obliga a intentar lo que se puede deshacer.",
      "El piso de tasa (no bajar de la del crédito original) es el único que no ordena un proceso: tapa una fuga de plata, porque bajar la tasa condona interés sin pasar por el tope de las quitas. Viene prendido. Apagándolo, reestructurar puede salir más barato que el crédito viejo —que suele ser lo razonable, si el cliente no pudo pagar el original— y ahí la tasa mínima de la banda queda como único control.",
      "Un administrador puede pasar por encima de cualquiera de estas reglas; el vendedor no. Queda auditado.",
    ],
    ejemplo:
      "Un acuerdo roto devuelve el crédito exactamente como estaba y los punitorios vuelven a correr. " +
      "Una refinanciación no se deshace: el crédito viejo muere, nace uno nuevo con toda la deuda adentro " +
      "y al cliente se le descuentan 25 puntos de score. Por eso conviene que sea el último recurso y no el primero.",
  },
  plus_recupero: {
    titulo: "Plus por recupero",
    texto:
      "Un extra de comisión para el agente que vuelve a cobrarle a quien había dejado de pagar. La comisión de "
      + "venta premia otorgar; esto premia el trabajo más ingrato de la financiera. Se suma a su comisión del "
      + "mismo período y se paga en la misma liquidación, en una línea aparte.",
    puntos: [
      "Cuenta el COBRO entero cuando la cuota más vieja que alcanzó llevaba el umbral de recupero o más de atraso. Ese umbral no se configura acá: es el mismo «Entra en recupero a los…» de Acuerdos de pago.",
      "El atraso se mide con la fecha del pago contra el vencimiento de la cuota, que no cambian nunca: el plus de un mes cerrado no se mueve.",
      "La base es lo que se imputó a deuda (capital, interés, punitorios y cargos). Lo que el cliente dejó de más no cuenta, y un pago anulado tampoco.",
      "Se le acredita al DUEÑO del crédito aunque lo haya cobrado un compañero, igual que el resto del recupero. La plata sigue entrando a la caja de quien cobra.",
      "Con 0% no hay plus y el sistema se comporta como antes.",
    ],
    ejemplo:
      "Con 5%: un cliente con 72 días de atraso paga $180.000,00 y se imputan todos a deuda. Al dueño del crédito "
      + "se le suman $9.000,00 a la comisión del mes, aunque el cobro lo haya hecho otro agente.",
  },
  cobranza: {
    titulo: "Agenda de cobranza",
    texto:
      "La cola del día: a quién hay que contactar y en qué orden. Se arma sola en tres grupos por urgencia "
      + "—promesas vencidas, contactos agendados y morosos que nadie gestiona hace días— y ese orden entre "
      + "grupos no se configura. Lo que sí elegís es cada cuánto vuelve alguien a la cola y a quién llamar "
      + "primero DENTRO de cada grupo.",
    ejemplo:
      "Con «el que hace más días que no paga», una deuda de $8.000,00 con 200 días de atraso aparece ARRIBA de "
      + "una de $500.000,00 con 20 días. Con «el que más plata debe» se invierte: primero los $500.000,00. "
      + "Importa porque nadie llama la lista entera: el que queda al final no se llama.",
    puntos: [
      "Cobranza abierta: si un agente puede cobrarle a un cliente de otro. Apagada, el día que el agente que otorgó el crédito no viene, su cliente entra a pagar y el que lo atiende ve cero créditos. La plata entra siempre a la caja de quien cobra —es el que tiene los billetes— y el recupero se le acredita al dueño del crédito, así que al ausente no se le cae la meta.",
      "Días sin gestión: con 7, un moroso al que nadie llamó reaparece en «Hoy» a la semana de la última gestión.",
      "A quién llamar primero: ordena solo adentro de cada grupo. Una promesa vencida siempre va antes que un enfriado.",
      "El importe que muestra la agenda es lo VENCIDO (cuotas impagas + punitorios), no el préstamo entero.",
      "Quien está cumpliendo un acuerdo de pago no aparece en la cola — eso se configura en Acuerdos de pago.",
      "Los controles de la plata (gastos y anulaciones) se mudaron a la sección Cajas.",
    ],
  },
  acuerdos: {
    titulo: "Acuerdos de pago",
    texto: "El arreglo informal en cuotas con alguien que ya se atrasó: acordás cómo te paga lo VENCIDO, sin rehacer el crédito ni firmar nada nuevo. Lo que todavía no venció sigue su curso normal.",
    ejemplo:
      "Juan debe $50.000 vencidos: $30.000 de capital, $8.000 de interés y $12.000 de punitorios. " +
      "Le perdonás la mitad de los punitorios ($6.000) y le armás 4 cuotas de $11.000 cada 30 días. " +
      "Mientras cumple no se le suma más mora; si falta a las cuotas que definiste, el acuerdo se cae " +
      "y vuelve a la cola de morosos con los punitorios corriendo otra vez.",
    puntos: [
      "Máximo de cuotas: hasta dónde puede estirar el vendedor sin consultar. No es lo que va a ofrecer siempre, es su techo.",
      "Días entre cuotas: cada cuánto vence una cuota DEL ACUERDO. Es independiente del crédito: podés acordar semanal aunque el crédito sea mensual.",
      "Cuotas impagas que lo rompen: con 1 sos estricto (falta a una y se cae); con 2 o 3 le das margen para un tropiezo.",
      "Descuento máx. del vendedor: cuánto puede perdonar por su cuenta, en acuerdos, refinanciaciones Y campañas. En 0 no descuenta nada y todo descuento lo firma un admin, que no tiene tope (pero nunca más de 100%).",
      "La condonación sale de los punitorios y el interés, NUNCA del capital: la plata que se prestó de verdad no se regala.",
      "El acuerdo no toca el crédito: el cliente paga como siempre y el acuerdo se va cumpliendo solo con esos pagos.",
      "No hay botón para darlo por cumplido: se cumple cuando la plata entra, y eso lo detecta el sistema solo.",
    ],
  },
  plantillas: {
    titulo: "Mensajes al cliente",
    texto:
      "Los textos que salen cuando alguien aprieta «Contactar» en la ficha de un cliente. Hay uno por motivo "
      + "(mora, promoción, información) y sirven para los dos canales: el WhatsApp usa solo el mensaje, el email "
      + "le suma el asunto.",
    ejemplo:
      "Escribís «Hola [nombre], te habla [financiera]. Tenés $[deuda] vencidos hace [dias] días.» y al mandárselo "
      + "a Juan Pérez le llega «Hola Juan Pérez, te habla Credit Zero. Tenés $152.340,50 vencidos hace 12 días.» "
      + "La vista previa de la derecha muestra exactamente eso antes de guardar.",
    puntos: [
      "Los datos entre corchetes se reemplazan solos. Clic en la etiqueta y se inserta donde tenés el cursor.",
      "Solo se reemplazan las claves de la lista: cualquier otra cosa entre corchetes se manda tal cual.",
      "Los importes salen con centavos, iguales a los que después cobra la caja — si no, el cliente discute el vuelto.",
      "Solo el mensaje de MORA cuenta como gestión de cobranza. Los otros dos se registran en la ficha pero no mueven la efectividad del equipo.",
      "El asunto solo lo usa el email; en WhatsApp se ignora.",
      "Si borrás un texto y guardás, vuelve el que trae el sistema por defecto.",
    ],
  },
  plantillas_meta: {
    titulo: "Plantillas aprobadas por Meta",
    texto:
      "WhatsApp tiene dos formas de mandar un mensaje. Escribiéndolo a mano desde el teléfono —lo que hace el "
      + "sistema hoy— podés poner el texto que quieras. Con la API de WhatsApp Business, en cambio, Meta solo "
      + "entrega mensajes armados con una plantilla que aprobó ANTES, salvo que el cliente te haya escrito en las "
      + "últimas 24 horas. Acá se registran esas plantillas ya aprobadas para poder elegirlas al contactar o al "
      + "armar una campaña.",
    ejemplo:
      "Meta te aprueba «Hola {{1}}, tenés una cuota vencida por {{2}}. Comunicate con nosotros.» Registrás ese texto "
      + "tal cual, decís que la primera variable es el nombre y la segunda lo vencido, y al mandárselo a Juan Pérez "
      + "le llega «Hola Juan Pérez, tenés una cuota vencida por $39.187,40. Comunicate con nosotros.»",
    puntos: [
      "El sistema NO aprueba nada: la aprobación la da Meta en el Administrador de WhatsApp. Acá solo se registra.",
      "Cada plantilla es PARA UN MOTIVO (mora, promoción o información) y solo aparece cuando estás mandando ese motivo. Hace falta una por cada tipo de mensaje que quieras mandar: la exigencia de Meta no es por el motivo sino por la ventana de 24 h.",
      "Categoría según el motivo: una cobranza va como «Utilidad» y una oferta como «Marketing». Un reclamo aprobado como marketing no le llega a quien tiene la publicidad silenciada; una oferta aprobada como utilidad es lo que Meta re-categoriza y penaliza.",
      "El cuerpo va copiado exactamente, con sus variables numeradas. Si cambia una palabra, deja de estar aprobado y Meta no lo entrega.",
      "Cada variable tiene que tener un dato asignado. Si queda vacía, al cliente le llega la variable escrita en crudo.",
      "El signo $ no lo pone el sistema: si el importe va con peso, escribilo en el cuerpo que mandás a aprobar.",
      "Las campañas solo usan plantillas de MORA, y solo las que no pidan número de cuota ni fecha de vencimiento: una campaña no resuelve esos datos por cliente.",
      "No son obligatorias. Sin plantilla se manda texto libre y el sistema avisa antes de enviar — el aviso es más fuerte en una campaña que en un mensaje suelto.",
      "El riesgo real de mandar texto libre en volumen: los que bloquean o reportan bajan la calidad del número, primero se recorta el límite diario y después se pierde la línea.",
      "Apagar una plantilla la saca de los selectores sin borrarla: sirve cuando Meta la pausa.",
    ],
  },
  fallecidos: {
    titulo: "Clientes fallecidos",
    texto:
      "Cuando un cliente muere, la deuda no desaparece: pasa a la sucesión. Pero tampoco se la puede seguir " +
      "persiguiendo como si nada. Marcarlo como fallecido deja la deuda EN REVISIÓN — congelada y visible — " +
      "hasta que decidas si la condonás o vas por la vía legal. El sistema no da de baja nada solo.",
    ejemplo:
      "Ana debía $180.000,00 y falleció el 03/08. Un admin la marca como fallecida con esa fecha. " +
      "Los punitorios se frenan ese día: si el trámite tarda cuatro meses, la deuda sigue siendo $180.000,00 " +
      "y no $215.000,00. Nadie la llama ni le manda mensajes, y sale de la cola del cobrador. " +
      "La deuda sigue figurando en la cartera hasta que vos la resuelvas.",
    puntos: [
      "Solo un administrador puede marcar el estado. Frena la cobranza de toda la deuda de esa persona.",
      "El acta de defunción se pide y se archiva EN PAPEL: el sistema guarda el motivo escrito y quién lo registró.",
      "La FECHA que cargás es la que frena los punitorios. Si murió hace tres meses, esa mora no corresponde.",
      "A diferencia del acuerdo de pago, acá se congelan TODAS las cuotas, también las que vencen después: nadie las iba a pagar.",
      "Es reversible. Si fue un error o un homónimo, volvés a marcarlo activo y la mora retoma su curso.",
      "Todo queda en Auditoría: quién lo marcó, cuándo y con qué explicación.",
    ],
  },
  imputacion: {
    titulo: "Orden de imputación de pagos",
    texto: "Imputar es decidir a qué parte de la deuda se le descuenta la plata que entra. Solo importa cuando el cliente paga MENOS de lo que debe: si paga todo, el orden no cambia nada.",
    ejemplo:
      "Juan debe una cuota de $25.000: $3.000 de punitorios, $5.000 de interés, $2.000 de cargos y " +
      "$15.000 de capital. Paga $9.000. Con «integrado» se cubren los $3.000 de punitorios, los " +
      "$5.000 de interés y $1.000 de cargos. Con «separado» se cubren los punitorios, los $2.000 de " +
      "cargos enteros y $4.000 de interés. En los dos casos Juan pagó lo mismo y el capital quedó " +
      "intacto: lo único que cambia es en qué casillero se anotó cada peso.",
    puntos: [
      "La mora va primera para que la deuda deje de crecer: mientras queden punitorios sin pagar, el atraso sigue sumando.",
      "El capital va último a propósito. Si bajara primero, el préstamo se achicaría antes de haber cobrado lo que cuesta tenerlo.",
      "Además se salda la cuota MÁS VIEJA entera antes de tocar la siguiente — no se reparte un poco a cada una.",
      "Ese orden es fijo y no se configura: es el que fija la ley por defecto (art. 903 del Código Civil y Comercial — un pago a cuenta de capital e intereses se imputa primero a intereses). Lo único que elegís acá es dónde entran los cargos.",
      "Elijas lo que elijas, el cliente paga lo mismo y el capital baja igual: cambia el reparto contable, no la plata.",
    ],
  },
  financiacion: {
    titulo: "Financiación del simulador",
    texto: "Dos cosas distintas: lo que el simulador PROPONE al abrirlo, y los LÍMITES que no se pueden pasar. Un campo en 0 no hace nada.",
    puntos: [
      "Lo que propone: aparece cargado al abrir el simulador y el vendedor lo puede cambiar.",
      "Los límites: el simulador avisa en rojo mientras se escribe y el servidor rechaza el otorgamiento.",
      "El punto verde a la derecha del campo indica que ese límite está rigiendo.",
    ],
  },
  plazos: {
    titulo: "Planes de cuotas",
    texto: "Lo que el operador puede elegir en el simulador. Un plan es una combinación cerrada: tantas cuotas, con tal frecuencia. Si tu financiera cotiza con una tabla de coeficientes, cargalo acá y la cuota sale sola.",
    ejemplo: "Plan de 3 cuotas mensuales con coeficiente 0,415: un crédito de $500.000 paga 3 cuotas de $207.500 ($500.000 × 0,415). El sistema despeja solo la tasa que representa (y la guarda en el crédito), así que el resto del sistema —mora, refinanciación, C.F.T., PDF— no cambia en nada.",
    puntos: [
      "Coeficiente vacío: el plan se cotiza con la tasa que se tipea en el simulador, como siempre.",
      "Un plan con coeficiente necesita frecuencia: el mismo número significa otra cosa en semanal que en mensual.",
      "Frecuencia \"Todas\": el plan se ofrece con cualquier frecuencia activa (así funcionaban los plazos antes).",
      "Gastos administrativos: si los dejás en \"Los generales\", el plan usa los del bloque Cargos. Si los definís, mandan los del plan.",
      "La línea de abajo de cada plan muestra la cuota y la tasa que sale del coeficiente: si ves un número raro, hay un error de tipeo.",
      "Plan por defecto: el número de cuotas preseleccionado al simular.",
      "Tiene que quedar al menos uno activo, o no se puede otorgar ningún crédito mensual.",
    ],
  },
  frecuencias: {
    titulo: "Frecuencias de pago",
    texto: "Cada cuánto vence una cuota (mensual, semanal, etc.). Las base no se editan; podés crear las tuyas, como quincenal.",
    puntos: [
      "Cuotas fijas: la frecuencia impone ese número y el campo Cuotas queda bloqueado en el simulador.",
      "Frecuencia por defecto: la preseleccionada en el simulador. Tiene que estar activa.",
      "Tiene que quedar al menos una activa, o no se puede otorgar ningún crédito.",
      "Borrar una frecuencia no toca los créditos que ya la usan: cada crédito guarda su propia definición al otorgarse.",
    ],
  },
  redondeo: {
    titulo: "Redondeo de cuota",
    texto: "Ajusta la cuota FINAL (la que paga el cliente, ya con los cargos adentro) para que quede redonda.",
    puntos: [
      "Con el interruptor apagado: la cuota exacta que calcula el motor, con centavos.",
      "Prendido, el selector tiene dos opciones. Al entero: $26.751,75 → $26.752.",
      "A múltiplo: de a lo que definas. Con $100: $26.751,75 → $26.800.",
      "En las dos se redondea al más cercano, así que la cuota puede subir o bajar.",
      "La última cuota no se redondea: absorbe la diferencia para que el total cierre al centavo.",
    ],
  },
  cronograma: {
    titulo: "Cronograma de cobranza",
    texto: "Reglas de fechas del crédito. Se congelan al otorgarlo: cambiarlas no afecta a los créditos ya dados.",
    puntos: [
      "Día de vencimiento: día fijo del mes en que vence cada cuota. Vacío o 0 = un período después del desembolso.",
      "Día de corte: después de esa fecha, la 1ª cuota pasa al mes siguiente. Vacío o 0 = sin corte. Necesita un día de vencimiento.",
      "Esos dos SOLO valen para créditos mensuales.",
      "Días de gracia: el cliente sigue figurando en cobranza, pero no se le cobran punitorios hasta pasada la tolerancia. Vale en todas las frecuencias.",
      "Domingo, sábado y feriados: corren el vencimiento al próximo día hábil. Los tres vienen APAGADOS: si no activás ninguno, las fechas no se mueven.",
      "En diaria, ese corrimiento deja el cronograma en días hábiles sin amontonar dos cuotas el mismo día.",
    ],
  },
  cargos: {
    titulo: "Cargos del crédito",
    texto: "Comisiones e impuestos que se suman a la cuota o al costo del crédito. Cada uno se activa por separado; todo apagado = cuota pura (solo capital + interés).",
  },
  "cargo-comision": {
    titulo: "Comisión de otorgamiento",
    texto: "Cargo único por dar el crédito.",
    puntos: [
      "Modo: % del monto o un valor fijo.",
      "¿Financiada?: se cobra al inicio o se suma al capital y se paga en las cuotas.",
    ],
  },
  "cargo-iva": {
    titulo: "IVA sobre interés",
    texto: "Impuesto que se aplica sobre el interés de cada cuota. Cargá la tasa vigente (ej: 21%).",
  },
  "cargo-seguro": {
    titulo: "Seguro",
    texto: "Cobertura que se cobra en cada cuota.",
    puntos: ["Base: % del saldo, % del monto original o un monto fijo por cuota."],
  },
  "cargo-gastos": {
    titulo: "Gastos administrativos",
    texto: "Cargo administrativo que se suma a cada cuota, como monto fijo o % de la cuota.",
  },
  comunicaciones: {
    titulo: "Canales de comunicación",
    texto: "Conectá WhatsApp, SMS y Email para que el sistema mande los avisos de cobranza solo: 3 días antes del vencimiento, el día, y a los 5, 15 y 30 días de atraso, cada mañana. Cada canal se activa y guarda por separado, y tiene su «Enviar prueba».",
    puntos: [
      "El aviso sale por el primer canal que pueda: WhatsApp → SMS → Email. Si WhatsApp no tiene plantilla aprobada o el cliente no tiene teléfono, prueba el siguiente.",
      "Cada aviso queda como gestión automática en la ficha del cliente, diciendo por dónde salió — o por qué no salió por ninguno.",
      "Los mismos canales sirven para el contacto manual desde la ficha, la agenda y las campañas.",
      "El aviso lo firma la financiera con su nombre y teléfono (Configuración → Financiera): al cliente le escribe quien le prestó, no el software.",
    ],
  },
  "canal-whatsapp": {
    titulo: "WhatsApp (Meta)",
    texto: "Conexión con WhatsApp Cloud API para que los mensajes salgan solos. Sin esta API, el WhatsApp igual funciona: el sistema arma el mensaje y lo abre para que lo mande el operador.",
    puntos: [
      "Token y Phone Number ID: los provee Meta Business.",
      "Plantillas: el nombre exacto de cada mensaje aprobado en Meta, uno por cada aviso automático. Fuera de las 24 h desde el último mensaje del cliente, Meta solo entrega plantillas aprobadas.",
    ],
  },
  "canal-sms": {
    titulo: "SMS",
    texto: "Los avisos automáticos de cobranza por mensaje de texto salen desde un celular de la financiera, con su propia SIM, a través de SMSChef (smschef.com): se instala la app en ese celular, se lo vincula a la cuenta y acá se cargan el API secret (Tools → API Keys) y el ID del dispositivo (Devices). El plan gratuito da 1.500 mensajes por mes. El celular tiene que estar prendido y con señal: si no, los avisos quedan en cola.",
  },
  "canal-email": {
    titulo: "Email",
    texto: "Envío de correos con la casilla de la financiera. Con SMTP se usa una casilla de Gmail y una «contraseña de aplicación» (gratis, desde el día uno); Resend requiere un dominio propio verificado. Es el canal de los avisos automáticos cuando WhatsApp y SMS no pueden.",
    puntos: [
      "Guardá primero y después «Enviar prueba» a la casilla que quieras: la prueba usa la configuración guardada.",
      "Remitente: si queda vacío, sale de la misma casilla configurada.",
      "El cliente tiene que tener el email cargado en su ficha; si no, el aviso automático lo dice y pasa de largo.",
    ],
  },
  gamificacion: {
    titulo: "Gamificación",
    texto: "Cómo se calcula la medalla (Oro/Plata/Bronce) de cada vendedor según su rendimiento.",
    puntos: [
      "Período: cada cuánto se evalúa (mensual, trimestral, semestral).",
      "Pesos: cuánto influye cada objetivo (monto, cantidad, cobranza, calidad).",
      "Umbrales: el puntaje necesario para cada medalla.",
    ],
  },
  rentabilidad: {
    titulo: "Rentabilidad (costo de fondeo)",
    texto: "Cuánto te cuesta el dinero que prestás, para calcular la ganancia NETA en Reportes: ingreso financiero − costo de fondeo − gastos registrados.",
    puntos: [
      "Costo de fondeo anual: el interés que pagás por tu capital.",
      "Costos fuera de la caja ($ por mes): lo que se paga sin pasar por la caja del sistema (un alquiler desde una cuenta personal). Los gastos que SÍ cargás en Caja → Gasto ya se restan solos: no los repitas acá.",
      "Apagado: Reportes muestra el margen bruto (sin costo de fondeo), pero los gastos registrados se restan igual.",
    ],
  },
  riesgo: {
    titulo: "Política de originación",
    texto: "Qué mira el sistema al otorgar un crédito. Cada regla termina en una de tres respuestas: «califica»; «revisar», que avisa y deja otorgar; o «no califica», que hace lo elegido en «Si el cliente no califica». Los frenos absolutos no los levanta nadie.",
    opciones: [
      { opcion: "Ratio cuota / ingreso máx", efecto: "La cuota del crédito nuevo —pasada a mensual y con cargos— más las cuotas de los créditos que ya tiene no pueden superar ese % del sueldo. Si lo supera, no califica. En 0 nadie califica." },
      { opcion: "Tope de monto (× ingreso mensual)", efecto: "Monto máximo sugerido = sueldo × este número. Pasarse da «revisar», no rechaza. En 0 no hay tope." },
      { opcion: "Sueldo que debe quedarle libre", efecto: "Segunda chance para quien se pasa del ratio: si después de pagar todas sus cuotas le sigue quedando este % del sueldo, pasa a «revisar» en vez de no calificar. En 0 está apagado." },
      { opcion: "Situación BCRA máx aceptada", efecto: "Si el bureau informa una situación peor que esta (1 = normal, 5-6 = irrecuperable), no califica. Sin consulta al bureau no se evalúa." },
      { opcion: "Límite base sin bureau", efecto: "Cuando el cliente no tiene consulta al bureau, el monto sugerido no pasa de este importe. Pasarse da «revisar». En 0 no hay límite propio." },
      { opcion: "Máx. créditos activos por cliente", efecto: "Si ya tiene esa cantidad de créditos vigentes, no califica. En 0 no hay límite." },
      { opcion: "Máx. ediciones del sueldo (vendedor)", efecto: "Cuántas veces un vendedor puede cambiar el sueldo de un cliente. Al llegar, solo un administrador puede resetear el contador. El administrador no tiene tope. En 0 no hay límite." },
      { opcion: "Alerta por salto de sueldo", efecto: "Si el sueldo nuevo supera al anterior en más de este %, el sistema exige un motivo, que queda registrado. Vale para todos los usuarios. En 0 no pide nada." },
      { opcion: "Score externo mínimo", efecto: "Si el score del bureau (0 a 1000) está por debajo, no califica. En 0 no se exige." },
      { opcion: "Si el cliente no califica", efecto: "«Avisar y dejar autorizar»: un administrador puede otorgarlo igual y queda registrado quién lo autorizó; el vendedor no. «Bloquear»: no se otorga." },
      { opcion: "Si el cliente no tiene sueldo cargado", efecto: "Sin sueldo, el ratio y el tope por ingreso no se pueden calcular. «Pedir autorización»: lo otorga solo un administrador. «Bloquear»: hasta cargarle el sueldo. «Solo avisar»: se otorga igual." },
      { opcion: "Cuotas vencidas impagas", efecto: "Si tiene cuotas vencidas en un crédito vigente, no se le otorga, aunque «Si no califica» esté en «autorizar». Con «…pero un administrador puede autorizarlo» prendido, el admin lo puede firmar y queda registrado; el vendedor nunca." },
      { opcion: "Crédito incobrable", efecto: "Quien tiene un crédito castigado como incobrable no vuelve a sacar crédito. Freno absoluto: no lo autoriza nadie." },
      { opcion: "Refinanciación sin cancelar", efecto: "Hasta que termine de pagar su refinanciación no se le otorga otro crédito, aunque esté al día. Freno absoluto." },
      { opcion: "Cheques rechazados", efecto: "Si el bureau informa cheques rechazados sin regularizar, no califica." },
      { opcion: "Proceso judicial", efecto: "Si alguna entidad le inició juicio, no califica. Con «Avisar y dejar autorizar» no se bloquea: lo tiene que firmar un administrador." },
      { opcion: "Refinanció en otra entidad", efecto: "No lo descalifica: pasa a «revisar», porque es alguien que no pudo con su plan original." },
      { opcion: "Historial en la financiera (sin parámetro)", efecto: "Corre siempre: con historial de riesgo alto (categoría D) no califica; regular (C) da «revisar». Un cliente sin historial y sin consulta al bureau también da «revisar»." },
    ],
  },
  documentos: {
    titulo: "Documentos del crédito",
    texto: "Lo que se imprime en el pagaré y en las condiciones del préstamo (botón «Pagaré» en la ficha de cada crédito). Se define una vez y vale para todos los créditos; los datos de cada operación (monto, cuotas, tasas) los completa el sistema solo. Qué cambia en el papel cada opción:",
    opciones: [
      { opcion: "Pagaré: con monto impreso", efecto: "Va el total de las cuotas, en número y en letras." },
      { opcion: "Pagaré: en blanco", efecto: "El importe queda vacío (número y letras). En las condiciones se agrega la autorización del cliente para completarlo, al ejecutarlo, por lo que deba a esa fecha, nunca por más. Sin esa autorización escrita, un pagaré en blanco es fácil de impugnar." },
      { opcion: "Sin protesto", efecto: "Apagado, el título dice solo «PAGARÉ» y desaparece la frase «sin protesto»: para ejecutarlo hace falta un trámite notarial previo." },
      { opcion: "Intereses desde la presentación (art. 5)", efecto: "Agrega al pagaré que, desde que se presenta al cobro hasta que se paga, la suma devenga el punitorio del crédito, con la tasa escrita (art. 5, Dec. Ley 5965/63). Así el pagaré respalda también la mora, sin depender de las condiciones. Corre desde la presentación y no desde la firma, porque las cuotas ya traen el interés del préstamo. Sin mora activa en el crédito no se imprime." },
      { opcion: "Ampliar la presentación a 5 años", efecto: "Apagado, no se imprime la cláusula y rige el plazo de la ley: un año para presentar un pagaré a la vista." },
      { opcion: "Caducidad de plazos", efecto: "En 0 no se imprime. Con 1 o más, dice cuántas cuotas impagas hacen exigible el total." },
      { opcion: "Jurisdicción", efecto: "Se imprime la cláusula con el tribunal cargado. Sin ella, el deudor puede discutir dónde se lo demanda." },
      { opcion: "Actualizar por IPC", efecto: "Agrega la cláusula de ajuste por inflación de lo adeudado en mora." },
      { opcion: "Autorización a pedir informes", efecto: "Agrega la autorización a informar el comportamiento de pago (Ley 25.326)." },
      { opcion: "Cesión de crédito", efecto: "Agrega la cláusula que permite ceder el crédito a un tercero." },
      { opcion: "Entidad autorizada por el BCRA", efecto: "Aparece en el encabezado de las condiciones. Solo si la financiera tiene la autorización: declararlo sin tenerla es una infracción grave." },
      { opcion: "Cláusulas adicionales", efecto: "Van al final, como «Otras condiciones»." },
      { opcion: "Detalle de interés y capital en el recibo", efecto: "Prendido, el recibo de cada cobro desglosa cuánto fue a punitorios, a interés y a capital, y muestra el capital pendiente del crédito. Apagado, dice qué cuotas pagó, el monto y lo que le queda de ellas; la quita de una campaña y el saldo a favor se muestran igual." },
      { opcion: "Interés punitorio", efecto: "No se configura acá: sale de la mora que cobra el sistema (Motor financiero), así que el papel siempre coincide con lo que se cobra." },
    ],
  },
  notificaciones: {
    titulo: "Notificaciones",
    texto: "Elegí qué avisos aparecen en la campanita del sistema. No afecta los mensajes automáticos a clientes (eso se maneja en Comunicaciones).",
    puntos: [
      "Movimientos de caja: cobros, desembolsos y demás, en vivo (lo ven todos los roles).",
      "Respaldos: aviso si un backup falla o se atrasa (solo admin).",
      "Plan y facturación: avisos de vencimiento del plan (solo admin).",
      "Cobranzas: van AGRUPADAS, un aviso por pestaña y no uno por cliente. «Agenda de hoy» viene prendido; Vencimientos y Morosos se prenden acá si se quieren.",
      "Sonido: la campanita suena cuando llega algo nuevo (un movimiento de caja, un cierre con diferencia o una pestaña de cobranzas que creció).",
    ],
  },
  backups: {
    titulo: "Respaldos",
    texto:
      "Copia de seguridad de toda la base de datos. Corre automáticamente todas las noches, cifrada y guardada fuera del proveedor. Desde acá también podés forzar uno ahora mismo.",
    puntos: [
      "Automático: cada noche a las 03:00 (no hay que hacer nada).",
      "Manual: el botón «Backup ahora» genera una copia extra al instante.",
      "Los respaldos están cifrados: solo se restauran con la clave privada guardada offline.",
      "No incluye las imágenes subidas (logos/fotos): se guardan aparte en el almacenamiento de archivos.",
    ],
  },
};
