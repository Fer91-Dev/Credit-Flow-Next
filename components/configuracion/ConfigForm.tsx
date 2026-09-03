"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Loader2, Percent, Plus, X, MessageSquare, Phone, Mail, HelpCircle } from "lucide-react";
import { useConfiguracion, type ConfiguracionFinanciera, type GamificacionConfig, type RentabilidadConfig, type RiesgoConfig, type CobranzaConfig, type CajaConfig, type NotificacionesConfig, type OrdenAgenda } from "@/lib/swr";
import { FeatureGate } from "@/components/providers/FeaturesProvider";
import { FinancieraForm } from "@/components/configuracion/FinancieraForm";
import { BackupsView } from "@/components/configuracion/BackupsView";
import type { SimuladorConfig, CargosConfig, FrecuenciaOpcion, DocumentosConfig, ConvencionTasa, BureauConfigurable, BureauProveedorConfig, ModoInteresAcuerdo } from "@/lib/domain";
import { MODOS_INTERES_ACUERDO, MODO_INTERES_LABEL, BUREAUS_CONFIGURABLES, BUREAU_LABEL, BUREAU_REQUIERE_CREDENCIALES, resolverProveedoresBureau, DOCUMENTOS_DEFAULT, PLANTILLAS_CONTACTO_DEFAULT, revisarDocumentos, punitorioMensualDesdeDiaria, ORDEN_IMPUTACION, tasaDesdeCoeficiente, textoCuotas } from "@/lib/domain";
import { PageHeader } from "@/components/ui/PageHeader";
import { Emoji } from "@/components/ui/Emoji";
import { Field, Input, NumeroInput, Select, Textarea, SecretInput } from "@/components/ui/field";
import {
  advertirTasaAcuerdo, advertirMoraDiaria, advertirTopeMora, advertirDiasGracia,
  advertirCuotasAcuerdo, advertirMaxCreditosActivos, advertirRatioCuotaIngreso,
} from "@/lib/domain/config-advertencias";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { formatFecha, formatMonto, formatNumero } from "@/lib/utils";
import { PlantillasContactoEditor } from "@/components/configuracion/PlantillasContactoEditor";
import { PlantillasMetaEditor } from "@/components/configuracion/PlantillasMetaEditor";

/**
 * Día del mes (1–28) de los campos de cronograma, o `null` cuando el campo queda vacío.
 *
 * 🔴 **El 0 apaga el campo.** Antes el 0 se convertía en 1 en silencio, y "corte 1" no es
 * "sin corte": significa que casi todo crédito se va un mes más. En el resto del SaaS el 0
 * siempre quiere decir apagado (monto mínimo, tasa base, días de gracia, límite de
 * otorgamiento), así que un campo que hace lo contrario sin avisar es una trampa.
 */
const diaDelMes = (valor: string): number | null => {
  if (valor.trim() === "") return null;
  const n = parseInt(valor);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.min(28, n);
};

/** Sigla de la convención de tasa, para no mostrar un porcentaje sin decir de qué es. */
const CONVENCION_SIGLA: Record<ConvencionTasa, string> = {
  nominal_anual: "T.N.A.",
  efectiva_anual: "T.E.A.",
  mensual: "T.M.",
};

const ordenLabel: Record<string, string> = {
  mora: "Mora",
  interes: "Interés",
  capital: "Capital",
};

/**
 * Ayuda contextual por bloque de configuración: qué configura y con qué efecto.
 *
 * `ejemplo` es un caso resuelto con números. Va aparte de `puntos` porque explicar un
 * parámetro por definición ("cuántas cuotas se pueden ofrecer") no muestra la mecánica;
 * un caso con plata sí, y es lo que pidió el usuario al configurar acuerdos por primera vez.
 */
export type AyudaBloque = { titulo?: string; texto: string; ejemplo?: string; puntos?: string[] };

/**
 * Opciones del techo de mora.
 *
 * Se eligen de una lista y no se escribe un número libre porque el valor no es una
 * preferencia estética: define cuánto puede crecer una deuda. Un campo abierto invita a
 * poner "50" sin saber que eso apaga el punitorio a los 50 días con una tasa del 1%.
 *
 * 🔴 LA REDACCIÓN IMPORTA. La primera versión decía "Hasta 2 cuotas", y el usuario la leyó
 * como "2 cuotas vencidas" — que es otro concepto, y que además EXISTE en el sistema (las
 * cuotas impagas que rompen un acuerdo). El tope no cuenta cuotas: limita el IMPORTE de la
 * mora de cada cuota a un múltiplo de lo que vale esa cuota. Por eso ahora dice "veces el
 * valor de la cuota", que no se puede confundir con un conteo.
 */
/**
 * Con qué criterio se ordena la cola del día ADENTRO de cada grupo. Cada opción dice qué
 * pasa si se elige, porque las dos resignan algo y no hay una correcta.
 */
const ORDENES_AGENDA_UI: { key: OrdenAgenda; label: string; consecuencia: string }[] = [
  {
    key: "mora",
    label: "El que hace más días que no paga",
    consecuencia:
      "Prioriza la deuda más vieja, que es la más difícil de recuperar. Contra: una deuda chica y antigua "
      + "le gana a una grande y reciente, así que la plata más grande queda al final de la lista.",
  },
  {
    key: "monto",
    label: "El que más plata debe",
    consecuencia:
      "Prioriza la plata en juego: primero el vencido más alto. Contra: las deudas chicas se envejecen solas "
      + "abajo de la lista, y cuanto más vieja es una deuda menos se cobra.",
  },
];

const TOPES_MORA = [
  { pct: 0,   label: "Sin tope — la mora crece para siempre" },
  { pct: 100, label: "1 vez el valor de la cuota (100%)" },
  { pct: 200, label: "2 veces el valor de la cuota (200%)" },
  { pct: 300, label: "3 veces el valor de la cuota (300%)" },
] as const;

const AYUDA: Record<string, AyudaBloque> = {
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
      "Gasto máximo del vendedor: cuánto puede descontar de su caja por su cuenta. En 0 no puede ninguno.",
      "Días para anular un cobro: la ventana para deshacer un pago cargado por error. Después queda firme.",
    ],
    ejemplo:
      "El gasto en 0 (como viene) es a propósito. Todas las noches el vendedor cierra su caja: cuenta la plata y el sistema " +
      "compara con lo que debería tener. Si falta, queda pendiente y lo resolvés vos con un motivo escrito. Si pudiera " +
      "anotar gastos solo, a uno al que le faltan $80.000 le alcanzaría con escribir «combustible $80.000» para que esa " +
      "noche le cierre cuadrado y el faltante no aparezca nunca. Si le querés dar caja chica para nafta o viáticos, " +
      "ponele el techo que te parezca: por encima de ese número, el gasto lo cargás vos desde la caja principal.",
  },
  escalera: {
    titulo: "Escalera de recupero",
    texto:
      "Cuando alguien se atrasa hay tres formas de recuperarlo, de la más blanda a la más definitiva: " +
      "la promesa de pago (un compromiso verbal, no toca nada), el acuerdo (reparte lo vencido en cuotas y el " +
      "crédito sobrevive) y la refinanciación (cierra el crédito y nace otro con toda la deuda). " +
      "Acá decidís si hay que subir los escalones en orden o si el vendedor resuelve como pueda.",
    puntos: [
      "De fábrica está todo apagado: se puede ir directo a cualquiera de los tres.",
      "Los mínimos de atraso evitan refinanciar a alguien por tres días de demora.",
      "Exigir el acuerdo antes de refinanciar es la regla fuerte: obliga a intentar lo que se puede deshacer.",
      "El piso de tasa viene prendido: es el único que no ordena un proceso, tapa una fuga de plata.",
      "Un administrador puede pasar por encima de cualquiera de estas reglas; el vendedor no. Queda auditado.",
    ],
    ejemplo:
      "Un acuerdo roto devuelve el crédito exactamente como estaba y los punitorios vuelven a correr. " +
      "Una refinanciación no se deshace: el crédito viejo muere, nace uno nuevo con toda la deuda adentro " +
      "y al cliente se le descuentan 25 puntos de score. Por eso conviene que sea el último recurso y no el primero.",
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
      "Descuento máx. del vendedor: cuánto puede perdonar por su cuenta. En 0 no descuenta nada y todo descuento lo firma un admin, que no tiene tope.",
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
  presentacion: {
    titulo: "Presentación",
    texto: "Formato de la moneda y la región para mostrar los montos. No cambia ningún cálculo, solo cómo se ven los números.",
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
      "Apagado: la cuota exacta que calcula el motor, con centavos.",
      "Al entero: sin centavos.",
      "A múltiplo: redondea al múltiplo que definas (ej: de a $100).",
      "Redondea al más cercano: puede subir o bajar la cuota.",
      "La ÚLTIMA cuota absorbe la diferencia, así que no queda redonda.",
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
    texto: "Conectá WhatsApp, SMS y Email para que el sistema mande recordatorios y avisos de mora automáticamente. Cada canal se activa y guarda por separado.",
  },
  "canal-whatsapp": {
    titulo: "WhatsApp (Meta)",
    texto: "Conexión con WhatsApp Cloud API para enviar mensajes automáticos.",
    puntos: [
      "Token y Phone Number ID: los provee Meta Business.",
      "Plantillas: el nombre exacto de cada mensaje aprobado en Meta.",
    ],
  },
  "canal-sms": {
    titulo: "SMS",
    texto: "Envío de mensajes de texto vía un proveedor (Twilio, etc.). Cargá el proveedor y su API key.",
  },
  "canal-email": {
    titulo: "Email",
    texto: "Envío de correos. Elegí el proveedor (SMTP, Resend, SendGrid) y cargá sus credenciales.",
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
    texto: "Cuánto te cuesta el dinero que prestás, para calcular la ganancia NETA en Reportes.",
    puntos: [
      "Costo de fondeo anual: el interés que pagás por tu capital.",
      "Otros costos mensuales: gastos fijos operativos.",
      "Apagado: Reportes muestra el margen bruto (sin restar estos costos).",
    ],
  },
  riesgo: {
    titulo: "Política de originación",
    texto: "Reglas que definen si un cliente califica para un crédito y hasta qué monto.",
    puntos: [
      "Ratio cuota/ingreso: la cuota no puede superar ese % del sueldo.",
      "Tope por múltiplo de ingreso y límites de monto.",
      "Máx. créditos activos y bloqueo por mora previa.",
      "Si no califica: avisar y dejar autorizar, o bloquear.",
      "Cuotas vencidas impagas: es la única regla que puede frenar el otorgamiento aunque «Si no califica» esté en «autorizar». Con la excepción prendida, el admin puede firmarlo igual y queda registrado quién lo autorizó; el vendedor nunca.",
      "Sin sueldo cargado: no hay capacidad de pago que evaluar, así que el ratio y el múltiplo de ingreso no corren. Por defecto lo firma un administrador; también se puede bloquear o dejar pasar con aviso.",
    ],
  },
  documentos: {
    titulo: "Documentos del crédito",
    texto: "Lo que se imprime en la solicitud de préstamo y en el pagaré. Se define una vez y vale para todos los créditos; los datos de cada operación (monto, cuotas, tasas) los completa el sistema solo.",
    puntos: [
      "Jurisdicción: ante qué tribunales se reclama si hay que ir a juicio. Sin esto, el deudor puede discutir dónde se lo demanda.",
      "Punitorio mensual: el recargo por pagar tarde. En 0, atrasarse sale lo mismo que pagar a término.",
      "Pagaré con monto: se imprime la cifra. Sin monto: se completa el día que se ejecuta, con la deuda actualizada a esa fecha.",
      "Ampliación a 5 años: es el plazo para presentar un pagaré a la vista. Sin la cláusula, el plazo es mucho más corto.",
      "Autorizada por el BCRA: solo si la financiera realmente lo está. Declararlo sin serlo es una infracción grave.",
    ],
  },
  notificaciones: {
    titulo: "Notificaciones",
    texto: "Elegí qué avisos aparecen en la campanita del sistema. No afecta los mensajes automáticos a clientes (eso se maneja en Comunicaciones).",
    puntos: [
      "Movimientos de caja: cobros, desembolsos y demás, en vivo (lo ven todos los roles).",
      "Respaldos: aviso si un backup falla o se atrasa (solo admin).",
      "Plan y facturación: avisos de vencimiento del plan (solo admin).",
    ],
  },
};

export function ConfigForm() {
  const { config, error, isLoading, mutate } = useConfiguracion();

  const [form, setForm] = useState<ConfiguracionFinanciera | null>(null);
  // Guardado por bloque: qué bloque se está guardando / acaba de guardarse.
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [savedKey, setSavedKey] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  /** Bloque que rechazó el último guardado, para poder mostrarle el error AL LADO. */
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const toast = useToast();
  /**
   * Último modo de redondeo REAL elegido. El switch del bloque apaga poniendo
   * `modo: "ninguno"`; sin esta memoria, volver a encenderlo perdería la elección anterior
   * y habría que rearmarla desde cero.
   */
  const modoRedondeoPrevio = useRef<"entero" | "multiplo" | null>(null);
  const [activeTab, setActiveTab] = useState<"financiera" | "motor" | "simulador" | "comunicaciones" | "gamificacion" | "rentabilidad" | "riesgo" | "cobranza" | "cajas" | "documentos" | "notificaciones" | "backups">("financiera");

  // Hidratar el form local cuando llega la config.
  useEffect(() => {
    if (config) setForm(config);
  }, [config]);

  useEffect(() => {
    const modo = form?.simulador.redondeoCuota.modo;
    if (modo && modo !== "ninguno") modoRedondeoPrevio.current = modo;
  }, [form?.simulador.redondeoCuota.modo]);

  const touch = () => setSavedKey(null);
  const set = <K extends keyof ConfiguracionFinanciera>(key: K, value: ConfiguracionFinanciera[K]) => {
    setForm(prev => (prev ? { ...prev, [key]: value } : prev));
    touch();
  };

  // Setters anidados para el bloque del simulador.
  const setSim = <K extends keyof SimuladorConfig>(key: K, value: SimuladorConfig[K]) => {
    setForm(prev => (prev ? { ...prev, simulador: { ...prev.simulador, [key]: value } } : prev));
    touch();
  };
  const setCargo = <C extends keyof CargosConfig, F extends keyof CargosConfig[C]>(
    cargo: C, field: F, value: CargosConfig[C][F]
  ) => {
    setForm(prev => prev ? {
      ...prev,
      simulador: { ...prev.simulador, cargos: { ...prev.simulador.cargos, [cargo]: { ...prev.simulador.cargos[cargo], [field]: value } } },
    } : prev);
    touch();
  };

  // Guarda un subconjunto de la config; el PUT hace merge parcial sobre lo actual.
  const save = async (key: string, patch: Partial<ConfiguracionFinanciera>) => {
    setSavingKey(key);
    setSaveError(null);
    setErrorKey(null);
    setSavedKey(null);
    try {
      const res = await fetch("/api/configuracion", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "No se pudo guardar");
      await mutate(json.data, { revalidate: false });
      setSavedKey(key);
      setTimeout(() => setSavedKey(k => (k === key ? null : k)), 2500);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Error al guardar";
      setSaveError(msg);
      setErrorKey(key);
      /**
       * Toast además del cartel: el cartel vive ARRIBA de la pestaña y esta pantalla es larga.
       * Un rechazo al guardar Frecuencias —que está al fondo— dejaba el aviso fuera de
       * pantalla, y el usuario se quedaba mirando unos interruptores apagados que en la base
       * seguían encendidos. El toast es fijo: se ve estés donde estés.
       */
      toast.error(msg);
    } finally {
      setSavingKey(null);
    }
  };
  // Los bloques del simulador comparten la misma columna JSON: cada uno guarda todo el bloque.
  const saveSim = (key: string) => { if (form) save(key, { simulador: form.simulador }); };

  // Gamificación: config con fallback a defaults + setter parcial (merge profundo de pesos/umbrales).
  const g = form?.gamificacionConfig ?? defaultGamificacion();
  const setGam = (patch: Partial<GamificacionConfig>) => {
    setForm(prev => prev ? { ...prev, gamificacionConfig: { ...defaultGamificacion(), ...prev.gamificacionConfig, ...patch } } : prev);
    touch();
  };

  // Cobranza: agenda del día (cada cuántos días un moroso sin gestión reaparece en la cola).
  const cobranza = form?.cobranzaConfig ?? defaultCobranza();
  /** Patch anidado de la política de acuerdos (vive dentro de cobranza_config). */
  const setAcuerdos = (patch: Partial<CobranzaConfig["acuerdos"]>) =>
    setCobranza({ acuerdos: { ...cobranza.acuerdos, ...patch } });
  /**
   * El modo `sin_interes` MANDA sobre la tasa: `resolverTasaAcuerdo` devuelve 0 sin mirar
   * `tasa_mensual`. Los campos de tasa se apagan en vez de quedar aceptando un número que el
   * motor ignora — un campo editable que no hace nada es peor que uno que no está.
   */
  const sinInteres = cobranza.acuerdos.modo_interes === "sin_interes";
  /** Patch anidado de la escalera de recupero (vive dentro de cobranza_config). */
  const setRecupero = (patch: Partial<CobranzaConfig["recupero"]>) =>
    setCobranza({ recupero: { ...cobranza.recupero, ...patch } });
  /** Patch anidado de la política de clientes fallecidos. */
  const setFallecidos = (patch: Partial<CobranzaConfig["fallecidos"]>) =>
    setCobranza({ fallecidos: { ...cobranza.fallecidos, ...patch } });
  /** Patch anidado de los textos del contacto individual. */
  const setContacto = (patch: Partial<CobranzaConfig["contacto"]>) =>
    setCobranza({ contacto: { ...cobranza.contacto, ...patch } });

  const setCobranza = (patch: Partial<CobranzaConfig>) => {
    setForm(prev => prev ? { ...prev, cobranzaConfig: { ...defaultCobranza(), ...prev.cobranzaConfig, ...patch } } : prev);
    touch();
  };

  // Cajas: controles de tesorería (tope de gasto del vendedor, ventana de anulación).
  const caja = form?.cajaConfig ?? defaultCaja();
  const setCaja = (patch: Partial<CajaConfig>) => {
    setForm(prev => prev ? { ...prev, cajaConfig: { ...defaultCaja(), ...prev.cajaConfig, ...patch } } : prev);
    touch();
  };

  // Notificaciones in-app: qué avisos muestra la campanita.
  const notif = form?.notificacionesConfig ?? defaultNotificaciones();
  const setNotif = (patch: Partial<NotificacionesConfig>) => {
    setForm(prev => prev ? { ...prev, notificacionesConfig: { ...defaultNotificaciones(), ...prev.notificacionesConfig, ...patch } } : prev);
    touch();
  };

  // Documentos: parametrización de la solicitud/mutuo + pagaré.
  const docs = form?.documentosConfig ?? DOCUMENTOS_DEFAULT;
  const setDocs = (patch: Partial<DocumentosConfig>) => {
    setForm(prev => prev ? { ...prev, documentosConfig: { ...DOCUMENTOS_DEFAULT, ...prev.documentosConfig, ...patch } } : prev);
    touch();
  };
  // Avisos de "esto va a salir débil": no bloquean, marcan.
  /**
   * El punitorio del documento se DERIVA de la mora que el motor cobra: una sola fuente.
   * Si la mora está apagada, el documento declara 0 — que es la verdad.
   */
  const punitorioMensual = form?.moraActiva ? punitorioMensualDesdeDiaria(form.tasaMoraDiaria) : 0;
  /** Días de atraso en los que la mora alcanza el tope. Es lo que vuelve entendible un %. */
  const topeDias = form && form.tasaMoraDiaria > 0 && form.topeMoraPct > 0
    ? Math.round(form.topeMoraPct / 100 / form.tasaMoraDiaria)
    : 0;
  /** true cuando el valor guardado no coincide con ninguna opción de la lista. */
  const [topeManual, setTopeManual] = useState(false);
  const topePersonalizado = topeManual || (!!form && !TOPES_MORA.some(o => o.pct === form.topeMoraPct));
  const setTopePersonalizado = setTopeManual;

  /**
   * Qué pasa en el sistema con la opción elegida. Se calcula con la TASA CARGADA, así que el
   * "a los N días" es el de esta financiera y no un ejemplo genérico.
   */
  const topeConsecuencia = !form
    ? ""
    : form.topeMoraPct === 0
      ? form.tasaMoraDiaria > 0
        ? `La mora no para nunca: a los ${Math.round(1 / form.tasaMoraDiaria)} días ya iguala a la cuota y sigue. Los reportes van a incluir punitorios que nadie va a pagar.`
        : "La mora no tiene techo."
      : topeDias > 0
        ? `La mora de CADA cuota corre normal los primeros ${topeDias} días de atraso y ahí se detiene: nunca supera ${form.topeMoraPct / 100} ${form.topeMoraPct === 100 ? "vez" : "veces"} lo que vale esa cuota. Cobrás menos en los que pagan muy tarde, pero la deuda sigue siendo pagable y los reportes muestran plata real.`
        : `La mora de cada cuota se detiene al llegar al ${form.topeMoraPct}% de lo que vale esa cuota.`;
  const avisosDocs = revisarDocumentos(docs, punitorioMensual);

  // Rentabilidad: costo de fondeo para la ganancia NETA de Reportes.
  const rent = form?.rentabilidadConfig ?? defaultRentabilidad();
  const setRent = (patch: Partial<RentabilidadConfig>) => {
    setForm(prev => prev ? { ...prev, rentabilidadConfig: { ...defaultRentabilidad(), ...prev.rentabilidadConfig, ...patch } } : prev);
    touch();
  };

  // Riesgo / originación (feature premium): política de límites por ingreso + bureau.
  const riesgo = form?.riesgoConfig ?? defaultRiesgo();
  const setRiesgo = (patch: Partial<RiesgoConfig["politica"]>) => {
    setForm(prev => {
      if (!prev) return prev;
      const base = prev.riesgoConfig ?? defaultRiesgo();
      return { ...prev, riesgoConfig: { ...base, politica: { ...defaultRiesgo().politica, ...base.politica, ...patch } } };
    });
    touch();
  };
  const setBureau = (patch: Partial<RiesgoConfig["bureau"]>) => {
    setForm(prev => {
      if (!prev) return prev;
      const base = prev.riesgoConfig ?? defaultRiesgo();
      return { ...prev, riesgoConfig: { ...base, bureau: { ...defaultRiesgo().bureau, ...base.bureau, ...patch } } };
    });
    touch();
  };

  /** Config por bureau, completada desde los campos viejos si la financiera nunca la tocó. */
  const proveedoresBureau = resolverProveedoresBureau(riesgo.bureau);

  /** Prende/apaga un bureau o edita SUS credenciales, sin tocar las de los demás. */
  const setProveedorBureau = (clave: BureauConfigurable, patch: Partial<BureauProveedorConfig>) => {
    setForm(prev => {
      if (!prev) return prev;
      const base = prev.riesgoConfig ?? defaultRiesgo();
      const actuales = resolverProveedoresBureau(base.bureau);
      return {
        ...prev,
        riesgoConfig: {
          ...base,
          bureau: {
            ...defaultRiesgo().bureau,
            ...base.bureau,
            proveedores: { ...actuales, [clave]: { ...actuales[clave], ...patch } },
          },
        },
      };
    });
    touch();
  };

  // ¿El bloque `key` tiene cambios sin guardar respecto de la config del server?
  // Alimenta el estado "dirty" del botón Guardar (sólido solo cuando hay algo que guardar).
  const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  const isDirty = (key: string): boolean => {
    if (!config || !form) return false;
    const f = form, c = config, s = form.simulador, cs = config.simulador;
    switch (key) {
      case "motor":         return f.convencionTasa !== c.convencionTasa || f.sistemaAmortizacion !== c.sistemaAmortizacion;
      case "mora":          return f.moraActiva !== c.moraActiva || f.tasaMoraDiaria !== c.tasaMoraDiaria || f.topeMoraPct !== c.topeMoraPct;
      case "cobranza":      return !eq(f.cobranzaConfig ?? null, c.cobranzaConfig ?? null);
      case "cajas":         return !eq(f.cajaConfig ?? null, c.cajaConfig ?? null);
      case "notificaciones": return !eq(f.notificacionesConfig ?? null, c.notificacionesConfig ?? null);
      case "imputacion":    return f.imputarCargos !== c.imputarCargos;
      case "presentacion":  return f.moneda !== c.moneda || f.locale !== c.locale;
      case "gamificacion":  return !eq(f.gamificacionConfig ?? null, c.gamificacionConfig ?? null);
      case "rentabilidad":  return !eq(f.rentabilidadConfig ?? null, c.rentabilidadConfig ?? null);
      case "riesgo":        return !eq(f.riesgoConfig ?? null, c.riesgoConfig ?? null);
      case "financiacion":  return !eq([s.montoMin, s.montoMax, s.montoDefault, s.tasaBase, s.tasaMin, s.tasaMax], [cs.montoMin, cs.montoMax, cs.montoDefault, cs.tasaBase, cs.tasaMin, cs.tasaMax]);
      case "plazos":        return !eq(s.plazos, cs.plazos) || s.plazoDefault !== cs.plazoDefault;
      case "frecuencias":   return !eq(s.frecuencias, cs.frecuencias) || s.frecuenciaDefault !== cs.frecuenciaDefault;
      case "redondeo":      return !eq(s.redondeoCuota, cs.redondeoCuota);
      case "cronograma":    return !eq([s.diaCorte, s.diaVencimientoFijo, s.diasGracia, s.incluirDomingoNoHabil, s.incluirSabadoNoHabil, s.feriados], [cs.diaCorte, cs.diaVencimientoFijo, cs.diasGracia, cs.incluirDomingoNoHabil, cs.incluirSabadoNoHabil, cs.feriados]);
      case "cargo-comision": return !eq(s.cargos.comisionOtorgamiento, cs.cargos.comisionOtorgamiento);
      case "cargo-iva":      return !eq(s.cargos.iva, cs.cargos.iva);
      case "cargo-seguro":   return !eq(s.cargos.seguro, cs.cargos.seguro);
      case "cargo-gastos":   return !eq(s.cargos.gastosAdministrativos, cs.cargos.gastosAdministrativos);
      case "canal-whatsapp": return !eq(f.whatsappConfig ?? null, c.whatsappConfig ?? null);
      case "canal-sms":      return !eq(f.smsConfig ?? null, c.smsConfig ?? null);
      case "canal-email":    return !eq(f.emailConfig ?? null, c.emailConfig ?? null);
      default:               return false;
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        icon="gear"
        title="Configuración"
        subtitle="Reglas del motor financiero. Cada bloque se guarda por separado."
        accent="primary"
      />

      {isLoading || !form ? (
        <BodySkeleton />
      ) : error ? (
        <div className="rounded-xl bg-destructive/10 border border-destructive/30 p-4 text-destructive text-sm">
          Error al cargar la configuración: {error.message}
        </div>
      ) : (
        <div className="w-full">
          {saveError && (
            <div className="mb-4 rounded-xl bg-destructive/10 border border-destructive/30 p-3 text-destructive text-sm">
              {saveError}
            </div>
          )}

          <div className="grid grid-cols-1 gap-5 md:grid-cols-[190px_1fr]">
            {/* ─ Rail de secciones (patrón settings: nav lateral) ─ */}
            <nav className="-mx-1 flex gap-1 overflow-x-auto px-1 md:mx-0 md:flex-col md:overflow-visible md:px-0">
              {([
                { key: "financiera",     label: "Datos de la financiera", emoji: "office-building" },
                { key: "motor",          label: "Motor financiero",       emoji: "gear" },
                { key: "simulador",      label: "Simulador",              emoji: "bar-chart" },
                { key: "comunicaciones", label: "Comunicaciones",         emoji: "speech-balloon" },
                { key: "gamificacion",   label: "Gamificación",           emoji: "trophy" },
                { key: "rentabilidad",   label: "Rentabilidad",           emoji: "chart-increasing" },
                { key: "riesgo",         label: "Riesgo / Originación",   emoji: "shield" },
                { key: "cobranza",       label: "Cobranza",               emoji: "telephone" },
                { key: "cajas",          label: "Cajas",                  emoji: "money-bag" },
                { key: "documentos",     label: "Documentos",             emoji: "scroll" },
                { key: "notificaciones", label: "Notificaciones",          emoji: "bell" },
                { key: "backups",        label: "Respaldos",              emoji: "package" },
              ] as const).map(tab => {
                const active = activeTab === tab.key;
                return (
                  <button
                    key={tab.key}
                    onClick={() => setActiveTab(tab.key)}
                    className={`flex shrink-0 items-center justify-between gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors md:w-full ${
                      active
                        ? "bg-primary/10 text-foreground ring-1 ring-inset ring-primary/30"
                        : "text-muted-foreground hover:bg-muted/10 hover:text-foreground"
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      <Emoji name={tab.emoji} className="h-4 w-4" /> {tab.label}
                    </span>
                  </button>
                );
              })}
              {/*
                Qué significa el asterisco. Sin esta línea el `*` es decorativo: en una
                pantalla donde CASI TODO tiene un default razonable, hay que poder distinguir
                el parámetro que la financiera elige del que el motor no puede resolver solo.
              */}
              <p className="mt-4 hidden md:block px-3 text-[11px] leading-relaxed text-muted-foreground/70">
                <span className="text-destructive">*</span> El motor no puede calcular sin este dato.
                El resto tiene un valor por defecto y en 0 simplemente queda apagado.
              </p>
            </nav>

            {/* ─ Contenido de la sección activa ─ */}
            <div className="min-w-0 space-y-4">

          {/* ─── Datos de la financiera (identidad del tenant) ─── */}
          {activeTab === "financiera" && <>
          <FinancieraForm />

          {/* Presentación */}
          <Section title="Presentación" desc="Formato de moneda y región (no afecta los cálculos)." ayuda={AYUDA.presentacion}
            onSave={() => save("presentacion", { moneda: form.moneda, locale: form.locale })}
            saving={savingKey === "presentacion"} saved={savedKey === "presentacion"} dirty={isDirty("presentacion")}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Moneda" hint="Código ISO 4217">
                <Select value={form.moneda} onChange={e => set("moneda", e.target.value)}>
                  <option value="ARS">ARS — Peso argentino</option>
                  <option value="COP">COP — Peso colombiano</option>
                  <option value="MXN">MXN — Peso mexicano</option>
                  <option value="USD">USD — Dólar</option>
                </Select>
              </Field>
              <Field label="Región (locale)">
                <Select value={form.locale} onChange={e => set("locale", e.target.value)}>
                  <option value="es-AR">es-AR — Argentina</option>
                  <option value="es-CO">es-CO — Colombia</option>
                  <option value="es-MX">es-MX — México</option>
                </Select>
              </Field>
            </div>
          </Section>
          </>}

          {/* ─── Motor tab: Motor financiero (primero) ─── */}
          {activeTab === "motor" && (
          <Section title="Motor financiero" desc="Cómo se interpreta la tasa y el sistema de cálculo." ayuda={AYUDA.motor}
            onSave={() => save("motor", { convencionTasa: form.convencionTasa, sistemaAmortizacion: form.sistemaAmortizacion })}
            saving={savingKey === "motor"} saved={savedKey === "motor"} dirty={isDirty("motor")}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field required label="Convención de tasa" hint="Cómo se interpreta el campo «tasa» de cada crédito">
                <Select value={form.convencionTasa} onChange={e => set("convencionTasa", e.target.value as ConfiguracionFinanciera["convencionTasa"])}>
                  <option value="nominal_anual">Nominal anual (TNA)</option>
                  <option value="efectiva_anual">Efectiva anual (TEA)</option>
                  <option value="mensual">Mensual</option>
                </Select>
              </Field>
              <Field required label="Sistema de amortización">
                <Select value={form.sistemaAmortizacion} onChange={e => set("sistemaAmortizacion", e.target.value as ConfiguracionFinanciera["sistemaAmortizacion"])}>
                  <option value="frances">Francés (cuota fija)</option>
                </Select>
              </Field>
            </div>
          </Section>
          )}

          {/* ─── Simulador tab ─── */}
          {activeTab === "simulador" && <>

          {/* Simulador · Financiación */}
          {/*
            Los seis campos vivían en una sola grilla y no se entendía cuál hacía qué: "monto
            máximo" y "monto por defecto" se leen igual de importantes, y son cosas distintas.
            Uno PROPONE (el vendedor lo cambia) y el otro LIMITA (no lo puede pasar). Separarlos
            en dos grupos hace el trabajo que antes se le pedía al texto de ayuda.
          */}
          <Section title="Financiación del simulador" desc="Qué propone el simulador al abrirlo, y entre qué valores se puede otorgar." ayuda={AYUDA.financiacion}
            onSave={() => saveSim("financiacion")} saving={savingKey === "financiacion"} saved={savedKey === "financiacion"} dirty={isDirty("financiacion")} error={errorKey === "financiacion" ? saveError ?? undefined : undefined}>
            <div className="space-y-5">

              <SubGrupo titulo="Lo que el simulador propone" nota="Solo son valores de arranque: el vendedor los puede cambiar">
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                  {/*
                    Dice "en el simulador" a propósito: con tres campos de tasa en el bloque, el
                    usuario preguntó cuál era la que efectivamente se ve. El rótulo del grupo no
                    alcanzaba — la respuesta tiene que estar pegada al campo.
                  */}
                  <Field label="Monto ($)" hint={<EstadoParam on={form.simulador.montoDefault > 0} siOn="Se carga solo en el simulador" siOff="El simulador arranca vacío" />}>
                    <NumeroInput min="0"
                  value={form.simulador.montoDefault}
                  onValueChange={v => setSim("montoDefault", v)}
                />
                  </Field>
                  <Field label={`Tasa (% ${CONV_CORTA[form.convencionTasa]})`} hint={<EstadoParam on={form.simulador.tasaBase > 0} siOn="Se carga sola en el simulador" siOff="El simulador arranca vacío" />}>
                    <div className="relative">
                      <NumeroInput min="0" className="pr-7" value={form.simulador.tasaBase}
                        onValueChange={v => setSim("tasaBase", v)} />
                      <Percent className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
                    </div>
                  </Field>
                </div>
              </SubGrupo>

              <SubGrupo titulo="Límites de lo que se puede otorgar" nota="En 0 el límite no se aplica">
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                  <Field label="Monto mínimo ($)" hint={<EstadoParam on={form.simulador.montoMin > 0} siOn="No se otorga menos" siOff="Sin mínimo" />}>
                    <NumeroInput min="0"
                  value={form.simulador.montoMin}
                  onValueChange={v => setSim("montoMin", v)}
                />
                  </Field>
                  <Field label="Monto máximo ($)" hint={<EstadoParam on={form.simulador.montoMax > 0} siOn="No se otorga más" siOff="Sin tope" />}>
                    <NumeroInput min="0"
                  value={form.simulador.montoMax}
                  onValueChange={v => setSim("montoMax", v)}
                />
                  </Field>
                  <Field label="Tasa mínima (%)" hint={<EstadoParam on={form.simulador.tasaMin > 0} siOn="No se otorga por debajo" siOff="Sin mínimo" />}>
                    <div className="relative">
                      <NumeroInput min="0" className="pr-7" value={form.simulador.tasaMin}
                        onValueChange={v => setSim("tasaMin", v)} />
                      <Percent className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
                    </div>
                  </Field>
                  <Field label="Tasa máxima (%)" hint={<EstadoParam on={form.simulador.tasaMax > 0} siOn="No se otorga por encima" siOff="Sin tope" />}>
                    <div className="relative">
                      <NumeroInput min="0" className="pr-7" value={form.simulador.tasaMax}
                        onValueChange={v => setSim("tasaMax", v)} />
                      <Percent className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
                    </div>
                  </Field>
                </div>
              </SubGrupo>

            </div>
          </Section>

          {/* Simulador · Planes */}
          <Section title="Planes de cuotas" desc="Lo que se le ofrece al cliente. Cada plan es una combinación cerrada de cuotas y frecuencia, y puede llevar su propio coeficiente y gastos." ayuda={AYUDA.plazos}
            onSave={() => saveSim("plazos")} saving={savingKey === "plazos"} saved={savedKey === "plazos"} dirty={isDirty("plazos")} error={errorKey === "plazos" ? saveError ?? undefined : undefined}>
            <PlanesEditor
              planes={form.simulador.plazos}
              frecuencias={form.simulador.frecuencias}
              convencion={form.convencionTasa}
              tasaMin={form.simulador.tasaMin}
              tasaMax={form.simulador.tasaMax}
              onChange={p => setSim("plazos", p)}
            />
            <div className="mt-4 max-w-xs">
              <Field label="Plan por defecto" hint="Preseleccionado en el simulador">
                <Select value={String(form.simulador.plazoDefault)} onChange={e => setSim("plazoDefault", parseInt(e.target.value))}>
                  {/* Se elige por número de cuotas: es lo que el simulador prellena, y dos
                      planes activos no pueden compartir cuotas+frecuencia. */}
                  {[...new Set(form.simulador.plazos.filter(p => p.activo).map(p => p.cuotas))].sort((a, b) => a - b).map(c => (
                    <option key={c} value={c}>{c} cuotas</option>
                  ))}
                  {form.simulador.plazos.filter(p => p.activo).length === 0 && <option value="">— sin planes activos —</option>}
                </Select>
              </Field>
            </div>
          </Section>

          {/* Simulador · Frecuencias */}
          <Section title="Frecuencias de pago" desc="Frecuencias ofrecidas en el simulador. Las base no se editan; podés agregar propias (ej. quincenal)." ayuda={AYUDA.frecuencias}
            onSave={() => saveSim("frecuencias")} saving={savingKey === "frecuencias"} saved={savedKey === "frecuencias"} dirty={isDirty("frecuencias")} error={errorKey === "frecuencias" ? saveError ?? undefined : undefined}>
            <FrecuenciasEditor
              frecuencias={form.simulador.frecuencias}
              onChange={f => setSim("frecuencias", f)}
            />
            <div className="mt-4 max-w-xs">
              <Field required label="Frecuencia por defecto" hint="Preseleccionada en el simulador">
                <Select value={form.simulador.frecuenciaDefault} onChange={e => setSim("frecuenciaDefault", e.target.value)}>
                  {form.simulador.frecuencias.filter(f => f.activo).map(f => (
                    <option key={f.clave} value={f.clave}>{cap(f.label)}</option>
                  ))}
                  {form.simulador.frecuencias.filter(f => f.activo).length === 0 && <option value="">— sin frecuencias activas —</option>}
                </Select>
              </Field>
            </div>
          </Section>

          {/* Simulador · Redondeo */}
          {/*
            El encendido/apagado va en el switch de la cabecera, como en Cargos, Mora y los
            canales: "modo = ninguno" ES el estado apagado, y tenerlo escondido adentro de un
            desplegable dejaba el bloque sin estado visible. El desplegable ahora solo elige
            A QUÉ redondea. El campo Múltiplo se muestra únicamente cuando corresponde: antes
            estaba siempre presente y deshabilitado, así que se intentaba escribir en él sin
            haber cambiado el modo todavía.
          */}
          <Section title="Redondeo de cuota" desc="Deja la cuota del cliente en un número redondo. La última absorbe la diferencia." ayuda={AYUDA.redondeo}
            enabled={form.simulador.redondeoCuota.modo !== "ninguno"}
            onToggle={v => setSim("redondeoCuota", {
              ...form.simulador.redondeoCuota,
              modo: v ? (modoRedondeoPrevio.current || "multiplo") : "ninguno",
            })}
            onSave={() => saveSim("redondeo")} saving={savingKey === "redondeo"} saved={savedKey === "redondeo"} dirty={isDirty("redondeo")}
            error={errorKey === "redondeo" ? saveError ?? undefined : undefined}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Redondea">
                <Select value={form.simulador.redondeoCuota.modo === "ninguno" ? (modoRedondeoPrevio.current || "multiplo") : form.simulador.redondeoCuota.modo}
                  onChange={e => setSim("redondeoCuota", { ...form.simulador.redondeoCuota, modo: e.target.value as SimuladorConfig["redondeoCuota"]["modo"] })}>
                  <option value="entero">Al entero (sin centavos)</option>
                  <option value="multiplo">A múltiplo</option>
                </Select>
              </Field>
              {form.simulador.redondeoCuota.modo === "multiplo" && (
                <Field required label="Múltiplo" hint="Ej: 100 deja las cuotas de a $100">
                  <NumeroInput min="1" decimales={false}
                  value={form.simulador.redondeoCuota.multiplo}
                  onValueChange={v => setSim("redondeoCuota", { ...form.simulador.redondeoCuota, multiplo: v })}
                />
                </Field>
              )}
            </div>
          </Section>

          {/* Simulador · Cronograma de cobranza */}
          <Section title="Cronograma de cobranza" desc="Cuándo vence cada cuota y cuándo empieza a correr la mora. Se congela al otorgar." ayuda={AYUDA.cronograma}
            onSave={() => saveSim("cronograma")} saving={savingKey === "cronograma"} saved={savedKey === "cronograma"} dirty={isDirty("cronograma")}
            error={errorKey === "cronograma" ? saveError ?? undefined : undefined}>
            {/*
              Tres grupos, porque los cinco campos no pesan igual: los dos primeros solo
              existen para créditos MENSUALES, la gracia rige en todas las frecuencias, y el
              sábado y los feriados casi nadie los toca. Antes iban los cinco en fila y no
              había forma de saber cuál aplicaba a qué.
            */}
            <div className="space-y-5">
              <SubGrupo titulo="Cuándo vence la cuota" nota="solo créditos mensuales">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/*
                    🔴 EL CAMPO NUNCA SE MUESTRA EN BLANCO.
                    Un input vacío no dice nada: no se distingue "está apagado" de "nadie lo
                    configuró todavía". Y son dos lecturas MUY distintas cuando lo que está en
                    juego es la fecha en la que arranca a cobrarse un crédito. En el motor
                    `null` y `0` son el mismo valor (`calendar.ts`: `cfg.diaCorte ?? 0` y
                    `if (!cfg.diaVencimiento) return null`), así que mostrar 0 no cambia una
                    coma del cálculo — solo deja de esconder el estado.
                  */}
                  <Field label="Día de vencimiento" hint="1–28. En 0, la cuota vence un período después del desembolso">
                    <Input type="number" min="0" max="28" step="1"
                      value={form.simulador.diaVencimientoFijo ?? 0}
                      onChange={e => setSim("diaVencimientoFijo", diaDelMes(e.target.value))} />
                  </Field>
                  <Field label="Día de corte" hint="1–28. En 0 no hay corte. Necesita un día de vencimiento">
                    <Input type="number" min="0" max="28" step="1"
                      value={form.simulador.diaCorte ?? 0}
                      onChange={e => setSim("diaCorte", diaDelMes(e.target.value))} />
                  </Field>
                </div>
                <p className="mt-2 text-xs text-muted-foreground/60">
                  En semanal, quincenal y diaria las cuotas vencen un período después del desembolso y estos dos campos no se aplican.
                </p>
              </SubGrupo>

              <SubGrupo titulo="Cuándo empieza a correr la mora" nota="todas las frecuencias">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Field label="Días de gracia" advertencia={advertirDiasGracia(form.simulador.diasGracia)} hint="Tolerancia tras el vencimiento antes de la mora">
                    <NumeroInput min="0" decimales={false}
                  value={form.simulador.diasGracia}
                  onValueChange={v => setSim("diasGracia", Math.max(0, v))}
                />
                  </Field>
                  <div className="flex items-end pb-2 text-xs">
                    <EstadoParam
                      on={form.simulador.diasGracia > 0}
                      siOn={`Sin punitorios los primeros ${form.simulador.diasGracia} día${form.simulador.diasGracia === 1 ? "" : "s"} de atraso`}
                      siOff="La mora corre desde el día siguiente al vencimiento"
                    />
                  </div>
                </div>
              </SubGrupo>

              {/*
                Los dos APAGADOS por defecto. El domingo estuvo cableado en el motor sin forma
                de apagarlo; se hizo configurable por decisión del usuario, con el mismo
                criterio que el resto: nadie cambia de comportamiento sin haberlo elegido.
                Con los dos apagados y sin feriados, ninguna fecha se mueve.
              */}
              <SubGrupo titulo="Días no hábiles" nota="opcional · todo apagado = las fechas no se corren">
                <SwitchRow
                  title="Domingo no hábil"
                  desc="Si está activo, los vencimientos que caen domingo se corren al lunes."
                  checked={form.simulador.incluirDomingoNoHabil}
                  onChange={v => setSim("incluirDomingoNoHabil", v)}
                />
                <div className="mt-3">
                  <SwitchRow
                    title="Sábado no hábil"
                    desc="Si está activo, los vencimientos que caen sábado se corren al día hábil siguiente."
                    checked={form.simulador.incluirSabadoNoHabil}
                    onChange={v => setSim("incluirSabadoNoHabil", v)}
                  />
                </div>
                <div className="mt-4">
                  <FeriadosEditor feriados={form.simulador.feriados} onChange={f => setSim("feriados", f)} />
                </div>
              </SubGrupo>
            </div>

            {/*
              El día de corte es el único que cuelga del día de vencimiento fijo: sin él
              `calcularVencimientos` devuelve null y la grilla sale del cronograma clásico,
              que no mira el corte. El sábado y los feriados sí aplican siempre y en todas
              las frecuencias (`ajustarADiasHabiles` corre sobre el plan ya armado).
            */}
            {form.simulador.diaCorte && !form.simulador.diaVencimientoFijo ? (
              <p className="mt-4 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-700 dark:text-amber-400">
                El <b>día de corte</b> no se aplica sin un <b>día de vencimiento</b>: las cuotas vencen un período después del desembolso, sin liquidación mensual que correr.
              </p>
            ) : form.simulador.diaVencimientoFijo ? (
              <p className="mt-4 rounded-lg bg-muted/20 border border-border/60 px-3 py-2 text-[11px] text-muted-foreground/80">
                Los créditos mensuales vencen el <b>{form.simulador.diaVencimientoFijo}</b> de cada mes
                {form.simulador.diaCorte
                  ? <> y uno otorgado después del <b>{form.simulador.diaCorte}</b> arranca a cobrarse un mes más tarde</>
                  : <> (el primero, al mes siguiente del desembolso). <b>Sin día de corte</b>: uno otorgado un día antes del vencimiento igual cobra el período entero de interés</>}
                .{(form.simulador.incluirDomingoNoHabil || form.simulador.incluirSabadoNoHabil || form.simulador.feriados.length > 0) && <> Si esa fecha cae en un día no hábil, se corre al siguiente.</>}
              </p>
            ) : (
              /* Los dos en 0. Antes este caso no imprimía NADA: la sección quedaba muda
                 justo cuando los dos campos estaban apagados, que es el estado que más
                 necesita decirse en voz alta. */
              <p className="mt-4 rounded-lg bg-muted/20 border border-border/60 px-3 py-2 text-[11px] text-muted-foreground/80">
                Día de vencimiento y día de corte en <b>0</b>: las cuotas vencen <b>un período después del desembolso</b>, sin día fijo del mes.
              </p>
            )}
          </Section>

          {/* Simulador · Cargos */}
          <Section title="Cargos del crédito" desc="Comisiones e impuestos que se suman a la cuota o al costo total. Todo desactivado = cuota pura." ayuda={AYUDA.cargos}>
            <div className="space-y-3">
              {/* Comisión de otorgamiento */}
              <CargoBlock title="Comisión de otorgamiento" desc="Cargo único por dar el crédito." ayuda={AYUDA["cargo-comision"]}
                activo={form.simulador.cargos.comisionOtorgamiento.activo}
                onToggle={v => setCargo("comisionOtorgamiento", "activo", v)}
                onSave={() => saveSim("cargo-comision")} saving={savingKey === "cargo-comision"} saved={savedKey === "cargo-comision"} dirty={isDirty("cargo-comision")}
                error={errorKey === "cargo-comision" ? saveError ?? undefined : undefined}>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <Field label="Modo">
                    <Select value={form.simulador.cargos.comisionOtorgamiento.modo}
                      onChange={e => setCargo("comisionOtorgamiento", "modo", e.target.value as CargosConfig["comisionOtorgamiento"]["modo"])}>
                      <option value="porcentaje">% del monto</option>
                      <option value="fijo">Monto fijo</option>
                    </Select>
                  </Field>
                  {/*
                    La unidad en la etiqueta, como en Seguro y en Gastos. Este era el único de
                    los cuatro cargos que decía "Valor" a secas: con el modo en "% del monto",
                    un 5 son 5% y no $5, y no había forma de saberlo mirando el campo.
                    (Acá el valor se guarda como PORCENTAJE —5 = 5%—, al revés que en seguro y
                    gastos, que guardan la fracción. Cada pantalla convierte lo suyo.)
                  */}
                  <Field required={form.simulador.cargos.comisionOtorgamiento.activo} label={form.simulador.cargos.comisionOtorgamiento.modo === "fijo" ? "Valor ($)" : "Valor (%)"}>
                    <NumeroInput min="0"
                  value={form.simulador.cargos.comisionOtorgamiento.valor}
                  onValueChange={v => setCargo("comisionOtorgamiento", "valor", v)}
                />
                  </Field>
                  <Field label="¿Financiada?" hint="Se suma al capital y se amortiza">
                    <Select value={form.simulador.cargos.comisionOtorgamiento.financiada ? "si" : "no"}
                      onChange={e => setCargo("comisionOtorgamiento", "financiada", e.target.value === "si")}>
                      <option value="no">No (se cobra al inicio)</option>
                      <option value="si">Sí (financiada)</option>
                    </Select>
                  </Field>
                </div>
              </CargoBlock>

              {/* IVA */}
              <CargoBlock title="IVA sobre interés" desc="Impuesto sobre el interés de cada cuota." ayuda={AYUDA["cargo-iva"]}
                activo={form.simulador.cargos.iva.activo}
                onToggle={v => setCargo("iva", "activo", v)}
                onSave={() => saveSim("cargo-iva")} saving={savingKey === "cargo-iva"} saved={savedKey === "cargo-iva"} dirty={isDirty("cargo-iva")}
                error={errorKey === "cargo-iva" ? saveError ?? undefined : undefined}>
                <div className="max-w-[12rem]">
                  <Field required={form.simulador.cargos.iva.activo} label="Tasa de IVA (%)">
                    <NumeroInput min="0"
                  value={Number((form.simulador.cargos.iva.tasa * 100).toFixed(2))}
                  onValueChange={v => setCargo("iva", "tasa", (v) / 100)}
                />
                  </Field>
                </div>
              </CargoBlock>

              {/* Seguro */}
              <CargoBlock title="Seguro" desc="Cobertura aplicada por período." ayuda={AYUDA["cargo-seguro"]}
                activo={form.simulador.cargos.seguro.activo}
                onToggle={v => setCargo("seguro", "activo", v)}
                onSave={() => saveSim("cargo-seguro")} saving={savingKey === "cargo-seguro"} saved={savedKey === "cargo-seguro"} dirty={isDirty("cargo-seguro")}
                error={errorKey === "cargo-seguro" ? saveError ?? undefined : undefined}>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Field label="Base">
                    <Select value={form.simulador.cargos.seguro.modo}
                      onChange={e => setCargo("seguro", "modo", e.target.value as CargosConfig["seguro"]["modo"])}>
                      <option value="porcentaje_saldo">% del saldo</option>
                      <option value="porcentaje_monto">% del monto original</option>
                      <option value="fijo">Monto fijo por cuota</option>
                    </Select>
                  </Field>
                  <Field required={form.simulador.cargos.seguro.activo} label={form.simulador.cargos.seguro.modo === "fijo" ? "Valor ($)" : "Valor (%)"}>
                    <Input type="number" min="0" step="0.01"
                      value={form.simulador.cargos.seguro.modo === "fijo"
                        ? form.simulador.cargos.seguro.valor
                        : Number((form.simulador.cargos.seguro.valor * 100).toFixed(4))}
                      onChange={e => {
                        const raw = parseFloat(e.target.value) || 0;
                        setCargo("seguro", "valor", form.simulador.cargos.seguro.modo === "fijo" ? raw : raw / 100);
                      }} />
                  </Field>
                </div>
              </CargoBlock>

              {/* Gastos administrativos */}
              <CargoBlock title="Gastos administrativos" desc="Cargo por cuota." ayuda={AYUDA["cargo-gastos"]}
                activo={form.simulador.cargos.gastosAdministrativos.activo}
                onToggle={v => setCargo("gastosAdministrativos", "activo", v)}
                onSave={() => saveSim("cargo-gastos")} saving={savingKey === "cargo-gastos"} saved={savedKey === "cargo-gastos"} dirty={isDirty("cargo-gastos")}
                error={errorKey === "cargo-gastos" ? saveError ?? undefined : undefined}>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Field label="Modo">
                    <Select value={form.simulador.cargos.gastosAdministrativos.modo}
                      onChange={e => setCargo("gastosAdministrativos", "modo", e.target.value as CargosConfig["gastosAdministrativos"]["modo"])}>
                      <option value="fijo">Monto fijo por cuota</option>
                      <option value="porcentaje">% de la cuota</option>
                    </Select>
                  </Field>
                  <Field required={form.simulador.cargos.gastosAdministrativos.activo} label={form.simulador.cargos.gastosAdministrativos.modo === "fijo" ? "Valor ($)" : "Valor (%)"}>
                    <Input type="number" min="0" step="0.01"
                      value={form.simulador.cargos.gastosAdministrativos.modo === "fijo"
                        ? form.simulador.cargos.gastosAdministrativos.valor
                        : Number((form.simulador.cargos.gastosAdministrativos.valor * 100).toFixed(4))}
                      onChange={e => {
                        const raw = parseFloat(e.target.value) || 0;
                        setCargo("gastosAdministrativos", "valor", form.simulador.cargos.gastosAdministrativos.modo === "fijo" ? raw : raw / 100);
                      }} />
                  </Field>
                </div>
              </CargoBlock>
            </div>
          </Section>

          </>}



          {activeTab === "motor" && <>

          {/* Mora */}
          <Section title="Interés por mora" desc="Recargo aplicado por días de atraso. Apagá el switch para no cobrar mora." ayuda={AYUDA.mora}
            enabled={form.moraActiva} onToggle={v => set("moraActiva", v)}
            onSave={() => save("mora", { moraActiva: form.moraActiva, tasaMoraDiaria: form.tasaMoraDiaria, topeMoraPct: form.topeMoraPct })}
            saving={savingKey === "mora"} saved={savedKey === "mora"} dirty={isDirty("mora")}>
            <div className={`grid grid-cols-1 gap-4 sm:grid-cols-2 max-w-2xl transition-opacity ${form.moraActiva ? "" : "opacity-50"}`}>
              <Field required={form.moraActiva} label="Tasa de mora diaria (%)" advertencia={form.moraActiva ? advertirMoraDiaria(form.tasaMoraDiaria * 100) : null} hint="Porcentaje diario sobre la base de mora">
                <div className="relative">
                  <NumeroInput min="0" disabled={!form.moraActiva} className="pr-7" value={Number((form.tasaMoraDiaria * 100).toFixed(4))}
                        onValueChange={v => set("tasaMoraDiaria", (v) / 100)} />
                  <Percent className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
                </div>
              </Field>

              <Field
                label="Hasta dónde puede crecer la mora de una cuota"
                hint={topeConsecuencia}
                advertencia={form.moraActiva ? advertirTopeMora(form.topeMoraPct) : null}
              >
                {/*
                  Se elige de una LISTA y se expresa en CUOTAS, no en un % libre.
                  "200%" no le dice nada a nadie; "hasta 2 cuotas" se entiende solo. Y como
                  cada opción avisa a los cuántos días toca el techo CON LA TASA CARGADA, la
                  consecuencia se ve antes de guardar, no después con un moroso adelante.
                */}
                <Select
                  value={topePersonalizado ? "otro" : String(form.topeMoraPct)}
                  onChange={e => {
                    const v = e.target.value;
                    if (v === "otro") { setTopePersonalizado(true); return; }
                    setTopePersonalizado(false);
                    set("topeMoraPct", Number(v));
                  }}
                  disabled={!form.moraActiva}
                >
                  {TOPES_MORA.map(o => (
                    <option key={o.pct} value={o.pct}>{o.label}</option>
                  ))}
                  <option value="otro">Otro valor…</option>
                </Select>

                {topePersonalizado && (
                  <div className="relative mt-2">
                    <Input
                      type="number" min="0" max="1000" step="10"
                      value={form.topeMoraPct}
                      onChange={e => set("topeMoraPct", Math.max(0, Math.min(1000, parseFloat(e.target.value) || 0)))}
                      disabled={!form.moraActiva}
                      className="pr-7"
                      placeholder="% de la cuota"
                    />
                    <Percent className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
                  </div>
                )}
              </Field>
            </div>

          </Section>

          {/* Imputación */}
          <Section title="Orden de imputación de pagos" desc="Cuando un pago no alcanza a cubrir todo lo vencido, a qué parte de la deuda se le descuenta primero." ayuda={AYUDA.imputacion}
            onSave={() => save("imputacion", { imputarCargos: form.imputarCargos })}
            saving={savingKey === "imputacion"} saved={savedKey === "imputacion"} dirty={isDirty("imputacion")}>
            {/*
              Las etiquetas son INFORMACIÓN, no un control: muestran el orden que aplica el motor.
              Llevan su propio título para que no se lean como botones desactivados — antes acá
              decía que el reordenamiento "llegará en una fase próxima", y prometer una función
              que nadie tiene planeada es peor que explicar por qué el orden es el que es.
            */}
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2">
              Orden que aplica el motor
            </p>
            <div className="flex items-center gap-2 flex-wrap">
              {/*
                Se dibuja desde ORDEN_IMPUTACION, la constante que usa el propio motor. Antes
                salía de la configuración guardada, que el motor no leía: bastaba un valor raro
                en la base para que la pantalla mostrara un orden y la caja cobrara otro.
              */}
              {ORDEN_IMPUTACION.map((c, i) => (
                <div key={c} className="flex items-center gap-2">
                  <StatusBadge
                    label={`${i + 1}. ${ordenLabel[c] ?? c}`}
                    variant={c === "mora" ? "destructive" : c === "interes" ? "warning" : "primary"}
                  />
                  {i < ORDEN_IMPUTACION.length - 1 && <span className="text-muted-foreground/40">→</span>}
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground mt-3 max-w-2xl">
              Es fijo, y no por comodidad: el art. 903 del Código Civil y Comercial establece que un pago
              a cuenta de capital e intereses se imputa primero a los intereses. Además la mora va primera
              para que la deuda deje de crecer, el capital último para no achicar el préstamo antes de
              haber cobrado lo que cuesta tenerlo, y se salda la cuota más vieja entera antes de pasar a
              la siguiente.
            </p>

            <div className="mt-4 max-w-md border-t border-border pt-4">
              <Field
                label="Dónde entran los cargos"
                hint="IVA, seguro y gastos: si se cobran antes o después del interés. No cambia lo que paga el cliente ni cuánto baja el capital — solo en qué casillero se anota cada peso de un pago parcial."
              >
                <Select value={form.imputarCargos} onChange={e => set("imputarCargos", e.target.value as ConfiguracionFinanciera["imputarCargos"])}>
                  <option value="integrado">Después del interés (mora → interés → cargos → capital)</option>
                  <option value="separado">Antes del interés (mora → cargos → interés → capital)</option>
                </Select>
              </Field>
            </div>
          </Section>

          </>}

          {/* ─── Comunicaciones tab ─── */}
          {activeTab === "comunicaciones" && (
          <Section
            title="Canales de comunicación"
            desc="Configura los canales para notificaciones automáticas de cobranza (recordatorios, mora, vencimientos)."
            ayuda={AYUDA.comunicaciones}
          >
            <div className="space-y-4">
              {/* WhatsApp Cloud API */}
              <CanalesBlock
                icon={<MessageSquare className="w-4 h-4 text-success" />}
                title="WhatsApp Cloud API (Meta)"
                ayuda={AYUDA["canal-whatsapp"]}
                enabled={!!form.whatsappConfig?.enabled}
                onToggle={(v) => set("whatsappConfig", { ...(form.whatsappConfig ?? defaultWhatsapp()), enabled: v })}
                onSave={() => save("canal-whatsapp", { whatsappConfig: form.whatsappConfig ?? null } as any)}
                saving={savingKey === "canal-whatsapp"}
                saved={savedKey === "canal-whatsapp"}
                dirty={isDirty("canal-whatsapp")}
              >
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
                  <Field label="Token de acceso permanente">
                    <SecretInput
                      placeholder="EAAxxxxxx..."
                      value={(form.whatsappConfig as any)?.token ?? ""}
                      onChange={e => set("whatsappConfig", { ...(form.whatsappConfig ?? defaultWhatsapp()), token: e.target.value })}
                    />
                  </Field>
                  <Field label="Phone Number ID">
                    <Input
                      placeholder="123456789012345"
                      value={(form.whatsappConfig as any)?.phone_number_id ?? ""}
                      onChange={e => set("whatsappConfig", { ...(form.whatsappConfig ?? defaultWhatsapp()), phone_number_id: e.target.value })}
                    />
                  </Field>
                  <Field label="Business Account ID (opcional)">
                    <Input
                      placeholder="987654321098765"
                      value={(form.whatsappConfig as any)?.business_account_id ?? ""}
                      onChange={e => set("whatsappConfig", { ...(form.whatsappConfig ?? defaultWhatsapp()), business_account_id: e.target.value })}
                    />
                  </Field>
                </div>
                <p className="text-xs text-muted-foreground mt-3">
                  Plantillas de mensaje (nombre exacto aprobado en Meta Business Manager):
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-2">
                  {(["recordatorio", "vencimiento", "mora_temprana", "mora_media", "mora_critica"] as const).map(evento => (
                    <Field key={evento} label={eventoLabel(evento)}>
                      <Input
                        placeholder={`creditflow_${evento}`}
                        value={(form.whatsappConfig as any)?.templates?.[evento] ?? ""}
                        onChange={e => {
                          const base = form.whatsappConfig ?? defaultWhatsapp();
                          set("whatsappConfig", { ...base, templates: { ...(base as any).templates, [evento]: e.target.value } });
                        }}
                      />
                    </Field>
                  ))}
                </div>
              </CanalesBlock>

              {/* SMS */}
              <CanalesBlock
                icon={<Phone className="w-4 h-4 text-warning" />}
                title="SMS Gateway"
                ayuda={AYUDA["canal-sms"]}
                enabled={!!form.smsConfig?.enabled}
                onToggle={(v) => set("smsConfig", { ...(form.smsConfig ?? defaultSms()), enabled: v })}
                onSave={() => save("canal-sms", { smsConfig: form.smsConfig ?? null } as any)}
                saving={savingKey === "canal-sms"}
                saved={savedKey === "canal-sms"}
                dirty={isDirty("canal-sms")}
              >
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
                  <Field label="Proveedor">
                    <Select
                      value={(form.smsConfig as any)?.provider ?? "twilio"}
                      onChange={e => set("smsConfig", { ...(form.smsConfig ?? defaultSms()), provider: e.target.value })}
                    >
                      <option value="twilio">Twilio</option>
                      <option value="sms_masivos">SMS Masivos</option>
                      <option value="otro">Otro</option>
                    </Select>
                  </Field>
                  <Field label="API Key">
                    <SecretInput
                      placeholder="SK..."
                      value={(form.smsConfig as any)?.api_key ?? ""}
                      onChange={e => set("smsConfig", { ...(form.smsConfig ?? defaultSms()), api_key: e.target.value })}
                    />
                  </Field>
                </div>
              </CanalesBlock>

              {/* Email */}
              <CanalesBlock
                icon={<Mail className="w-4 h-4 text-primary" />}
                title="Email"
                ayuda={AYUDA["canal-email"]}
                enabled={!!form.emailConfig?.enabled}
                onToggle={(v) => set("emailConfig", { ...(form.emailConfig ?? defaultEmail()), enabled: v })}
                onSave={() => save("canal-email", { emailConfig: form.emailConfig ?? null } as any)}
                saving={savingKey === "canal-email"}
                saved={savedKey === "canal-email"}
                dirty={isDirty("canal-email")}
              >
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
                  <Field label="Proveedor">
                    <Select
                      value={(form.emailConfig as any)?.provider ?? "smtp"}
                      onChange={e => set("emailConfig", { ...(form.emailConfig ?? defaultEmail()), provider: e.target.value })}
                    >
                      {/* SendGrid estaba en la lista y el código no lo sabía mandar: elegirlo
                          no hacía nada. Mismo defecto que tenía SMTP. Se saca hasta que exista. */}
                      <option value="smtp">SMTP (tu casilla: Gmail, etc.)</option>
                      <option value="resend">Resend (requiere dominio propio)</option>
                    </Select>
                  </Field>
                  {(form.emailConfig as any)?.provider === "smtp" || !(form.emailConfig as any)?.provider ? (
                    <>
                      <Field label="Host SMTP"><Input placeholder="smtp.ejemplo.com" value={(form.emailConfig as any)?.host ?? ""} onChange={e => set("emailConfig", { ...(form.emailConfig ?? defaultEmail()), host: e.target.value })} /></Field>
                      <Field label="Puerto"><Input type="number" placeholder="587" value={(form.emailConfig as any)?.port ?? ""} onChange={e => set("emailConfig", { ...(form.emailConfig ?? defaultEmail()), port: parseInt(e.target.value) || 587 })} /></Field>
                      <Field label="Usuario"><Input placeholder="user@ejemplo.com" value={(form.emailConfig as any)?.user ?? ""} onChange={e => set("emailConfig", { ...(form.emailConfig ?? defaultEmail()), user: e.target.value })} /></Field>
                      <Field label="Contraseña"><SecretInput value={(form.emailConfig as any)?.pass ?? ""} onChange={e => set("emailConfig", { ...(form.emailConfig ?? defaultEmail()), pass: e.target.value })} /></Field>
                    </>
                  ) : (
                    <Field label="API Key"><SecretInput placeholder="re_xxxx / SG.xxxx" value={(form.emailConfig as any)?.api_key ?? ""} onChange={e => set("emailConfig", { ...(form.emailConfig ?? defaultEmail()), api_key: e.target.value })} /></Field>
                  )}
                  {/*
                    🔴 EL REMITENTE ESTABA CABLEADO en el código como
                    `CreditFlow <onboarding@resend.dev>`, en dos lugares distintos. Dos problemas:
                    al cliente le llegaba un mail firmado por el SISTEMA y no por la financiera
                    que le prestó, y —lo que rompe el envío— Resend solo deja mandar a terceros
                    desde un dominio verificado. Sin este campo no había forma de cambiarlo sin
                    tocar el código.
                  */}
                  <div className="sm:col-span-2">
                    <ProbarEmail />
                  </div>
                  <Field
                    label="Remitente (From)"
                    hint="El dominio tiene que estar verificado en tu proveedor. Vacío = la casilla de prueba, que solo llega a tu propio email."
                  >
                    <Input
                      placeholder="no-responder@tudominio.com"
                      value={(form.emailConfig as any)?.from_email ?? ""}
                      onChange={e => set("emailConfig", { ...(form.emailConfig ?? defaultEmail()), from_email: e.target.value.trim() })}
                    />
                  </Field>
                </div>
              </CanalesBlock>
            </div>
          </Section>
          )}

          {/* ─── Gamificación ─── */}
          {activeTab === "gamificacion" && (
          <Section
            title="Gamificación (medallas y logros)"
            desc="Cómo se calcula la medalla del vendedor: período, pesos de cada objetivo y umbrales de Oro/Plata/Bronce."
            ayuda={AYUDA.gamificacion}
            enabled={g.habilitado} onToggle={(v) => setGam({ habilitado: v })}
            onSave={() => save("gamificacion", { gamificacionConfig: g } as Partial<ConfiguracionFinanciera>)}
            saving={savingKey === "gamificacion"} saved={savedKey === "gamificacion"} dirty={isDirty("gamificacion")}
          >
            <div className="space-y-5">
              {/* Período */}
              <div className="max-w-xs">
                <Field label="Período de evaluación" hint="Largo de cada meta/medalla">
                  <Select value={g.periodo} onChange={e => setGam({ periodo: e.target.value as GamificacionConfig["periodo"] })}>
                    <option value="mensual">Mensual</option>
                    <option value="trimestral">Trimestral</option>
                    <option value="semestral">Semestral</option>
                  </Select>
                </Field>
              </div>

              <div className={g.habilitado ? "space-y-5" : "space-y-5 pointer-events-none opacity-40"}>
                {/* Pesos */}
                <div>
                  <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-2">Pesos del score (%)</p>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {([
                      ["monto", "Monto"], ["cantidad", "Cantidad"], ["cobranza", "Cobranza"], ["calidad", "Calidad (mora)"],
                    ] as const).map(([k, label]) => (
                      <Field key={k} label={label}>
                        <Input type="number" min="0" step="1" value={g.pesos[k]}
                          onChange={e => setGam({ pesos: { ...g.pesos, [k]: parseFloat(e.target.value) || 0 } })}
                          className="font-mono tabular-nums text-center" />
                      </Field>
                    ))}
                  </div>
                  <p className="text-[11px] text-muted-foreground/60 mt-1">Se normalizan automáticamente. "Calidad" premia baja morosidad (0 = no influye).</p>
                </div>

                {/* Umbrales */}
                <div>
                  <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-2">Umbrales de medalla (score 0–100)</p>
                  <div className="grid grid-cols-3 gap-3">
                    {([["oro", "🥇 Oro"], ["plata", "🥈 Plata"], ["bronce", "🥉 Bronce"]] as const).map(([k, label]) => (
                      <Field key={k} label={label}>
                        <Input type="number" min="0" max="100" step="1" value={g.umbrales[k]}
                          onChange={e => setGam({ umbrales: { ...g.umbrales, [k]: parseFloat(e.target.value) || 0 } })}
                          className="font-mono tabular-nums text-center" />
                      </Field>
                    ))}
                  </div>
                  <p className="text-[11px] text-muted-foreground/60 mt-1">Debe cumplirse Oro ≥ Plata ≥ Bronce.</p>
                </div>
              </div>
            </div>
          </Section>
          )}

          {/* ─── Rentabilidad (costo de fondeo) ─── */}
          {activeTab === "rentabilidad" && (
          <Section
            title="Rentabilidad (costo de fondeo)"
            desc="Costo del capital que prestás, para calcular la ganancia NETA en Reportes. Ingreso financiero (interés + cargos + mora cobrados) − este costo = rentabilidad neta. Apagá el switch para ver solo el margen bruto."
            ayuda={AYUDA.rentabilidad}
            enabled={rent.habilitado} onToggle={(v) => setRent({ habilitado: v })}
            onSave={() => save("rentabilidad", { rentabilidadConfig: rent } as Partial<ConfiguracionFinanciera>)}
            saving={savingKey === "rentabilidad"} saved={savedKey === "rentabilidad"} dirty={isDirty("rentabilidad")}
          >
            <div className="space-y-5">
              <div className={rent.habilitado ? "grid grid-cols-1 sm:grid-cols-2 gap-4" : "grid grid-cols-1 sm:grid-cols-2 gap-4 pointer-events-none opacity-40"}>
                <Field label="Costo de fondeo anual (%)" hint="Cuánto te cuesta por año el capital que prestás">
                  <Input type="number" min="0" step="0.1" value={rent.costo_fondeo_anual}
                    onChange={e => setRent({ costo_fondeo_anual: parseFloat(e.target.value) || 0 })}
                    className="font-mono tabular-nums" />
                </Field>
                <Field label="Otros costos mensuales ($)" hint="Costo operativo fijo por mes (opcional)">
                  <Input type="number" min="0" step="1" value={rent.otros_costos_mensuales}
                    onChange={e => setRent({ otros_costos_mensuales: parseFloat(e.target.value) || 0 })}
                    className="font-mono tabular-nums" />
                </Field>
              </div>
              <p className="text-[11px] text-muted-foreground/60">
                Con esto deshabilitado, Reportes muestra el <strong>margen bruto</strong> (sin costo de capital).
              </p>
            </div>
          </Section>
          )}

          {/* ─── Riesgo / Originación (motor base para todos; el bureau es premium) ─── */}
          {activeTab === "riesgo" && (
          <Section
            title="Política de originación"
            desc="Límites de crédito según el ingreso del cliente. Si un cliente no califica, la decisión queda en el admin (puede autorizar asumiendo el riesgo). Las señales de bureau (BCRA/Nosis) se conectan en un paso próximo."
            ayuda={AYUDA.riesgo}
            onSave={() => save("riesgo", { riesgoConfig: riesgo } as Partial<ConfiguracionFinanciera>)}
            saving={savingKey === "riesgo"} saved={savedKey === "riesgo"} dirty={isDirty("riesgo")}
            error={errorKey === "riesgo" ? saveError ?? undefined : undefined}
          >
            <div className="space-y-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field required label="Ratio cuota / ingreso máx (%)" advertencia={advertirRatioCuotaIngreso(riesgo.politica.ratioCuotaIngresoMax)} hint="La cuota no puede superar este % del ingreso neto del cliente. En 0 nadie califica.">
                  <div className="relative">
                    <Input type="number" min="1" max="100" step="1"
                      value={Number((riesgo.politica.ratioCuotaIngresoMax * 100).toFixed(0))}
                      onChange={e => setRiesgo({ ratioCuotaIngresoMax: Math.min(100, Math.max(1, parseFloat(e.target.value) || 0)) / 100 })}
                      className="pr-7" />
                    <Percent className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
                  </div>
                </Field>
                <Field label="Tope de monto (× ingreso mensual)" hint="Monto máx sugerido = múltiplo del sueldo. 0 = sin tope por múltiplo">
                  <Input type="number" min="0" step="0.5" value={riesgo.politica.multiploIngresoMax}
                    onChange={e => setRiesgo({ multiploIngresoMax: Math.max(0, parseFloat(e.target.value) || 0) })}
                    className="font-mono tabular-nums" />
                </Field>
                <Field
                  label="Sueldo que debe quedarle libre (%)"
                  hint="Segunda chance para quien se pasa del ratio: si aun así le queda libre este % del sueldo, en vez de rechazarlo lo manda a revisar. 0 = apagado."
                >
                  <div className="relative">
                    <Input type="number" min="0" max="100" step="1"
                      value={riesgo.politica.ingresoDisponibleMinPct}
                      onChange={e => setRiesgo({ ingresoDisponibleMinPct: Math.min(100, Math.max(0, parseFloat(e.target.value) || 0)) })}
                      className="pr-7" />
                    <Percent className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
                  </div>
                </Field>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="Situación BCRA máx aceptada" hint="Peor clasificación de deuda que se acepta (1 = normal)">
                  <Select value={String(riesgo.politica.situacionBcraMax)}
                    onChange={e => setRiesgo({ situacionBcraMax: parseInt(e.target.value) as RiesgoConfig["politica"]["situacionBcraMax"] })}>
                    <option value="1">1 — Normal</option>
                    <option value="2">2 — Riesgo bajo / seguimiento</option>
                    <option value="3">3 — Con problemas</option>
                    <option value="4">4 — Riesgo alto</option>
                    <option value="5">5 — Irrecuperable</option>
                    <option value="6">6 — Irrecuperable (téc.)</option>
                  </Select>
                </Field>
                <Field label="Límite base sin bureau ($)" hint="Tope de monto cuando no hay consulta a bureau. 0 = sin tope propio">
                  <Input type="number" min="0" step="1000" value={riesgo.politica.limiteBaseSinBureau}
                    onChange={e => setRiesgo({ limiteBaseSinBureau: Math.max(0, parseFloat(e.target.value) || 0) })}
                    className="font-mono tabular-nums" />
                </Field>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="Máx. créditos activos por cliente" advertencia={advertirMaxCreditosActivos(riesgo.politica.maxCreditosActivos)} hint="Tope de créditos vigentes simultáneos. 0 = sin límite">
                  <Input type="number" min="0" step="1" value={riesgo.politica.maxCreditosActivos}
                    onChange={e => setRiesgo({ maxCreditosActivos: Math.max(0, Math.trunc(parseFloat(e.target.value) || 0)) })}
                    className="font-mono tabular-nums" />
                </Field>
              </div>

              {/* Integridad del sueldo (anti-fraude del vendedor) */}
              <div className="border-t border-border pt-4">
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-3">Integridad del sueldo</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Field label="Máx. ediciones del sueldo (vendedor)" hint="Veces que un vendedor puede editar el ingreso antes de que un admin deba resetear. 0 = sin límite">
                    <Input type="number" min="0" step="1" value={riesgo.politica.maxEdicionesSueldoVendedor}
                      onChange={e => setRiesgo({ maxEdicionesSueldoVendedor: Math.max(0, Math.trunc(parseFloat(e.target.value) || 0)) })}
                      className="font-mono tabular-nums" />
                  </Field>
                  <Field label="Alerta por salto de sueldo (%)" hint="Si el nuevo sueldo supera al anterior en más de este %, se exige un motivo. 0 = sin alerta">
                    <div className="relative">
                      <Input type="number" min="0" step="5" value={riesgo.politica.alertaSaltoSueldoPct}
                        onChange={e => setRiesgo({ alertaSaltoSueldoPct: Math.max(0, parseFloat(e.target.value) || 0) })}
                        className="font-mono tabular-nums pr-7" />
                      <Percent className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
                    </div>
                  </Field>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* En 0 se muestra 0, no vacío: `riesgo.ts` ya trata null y 0 igual (con 0,
                    `score < 0` nunca es cierto → no exige nada). Se guarda null para no
                    ensuciar el JSON con un mínimo que no existe. */}
                <Field label="Score externo mínimo" hint="0–1000 (Nosis/Veraz). En 0 no se exige">
                  <Input type="number" min="0" max="1000" step="10"
                    value={riesgo.politica.scoreExternoMin ?? 0}
                    onChange={e => {
                      const n = Math.max(0, Math.min(1000, parseInt(e.target.value) || 0));
                      setRiesgo({ scoreExternoMin: n === 0 ? null : n });
                    }} />
                </Field>
                <Field label="Si el cliente no califica" hint="Qué hace el sistema cuando no cumple la política">
                  <Select value={riesgo.politica.accionAlNoCalificar}
                    onChange={e => setRiesgo({ accionAlNoCalificar: e.target.value as RiesgoConfig["politica"]["accionAlNoCalificar"] })}>
                    <option value="autorizar">Avisar y dejar autorizar (decisión humana)</option>
                    <option value="bloquear">Bloquear el otorgamiento</option>
                  </Select>
                </Field>
                {/*
                  Va pegado al de arriba porque es el mismo tipo de decisión, pero para el caso
                  en que NO HAY con qué evaluar. Sin sueldo, la capacidad de pago da cero y
                  todas las reglas que cuelgan del ingreso quedan mudas: lo que se elige acá es
                  qué pasa entonces.
                */}
                <Field label="Si el cliente no tiene sueldo cargado" hint="Sin ingreso no hay capacidad de pago que evaluar">
                  <Select value={riesgo.politica.accionSinIngreso}
                    onChange={e => setRiesgo({ accionSinIngreso: e.target.value as RiesgoConfig["politica"]["accionSinIngreso"] })}>
                    <option value="autorizar">Pedir autorización del administrador</option>
                    <option value="bloquear">Bloquear hasta cargarle el sueldo</option>
                    <option value="permitir">Solo avisar y otorgar igual</option>
                  </Select>
                </Field>
              </div>

              <SwitchRow
                title="Bloquear si tiene cuotas vencidas impagas"
                desc="No se le otorga a un cliente que ya está en mora con la financiera."
                checked={riesgo.politica.bloquearConCuotasVencidas}
                onChange={v => setRiesgo({ bloquearConCuotasVencidas: v })}
              />

              {/*
                Anidado y solo visible con el freno prendido: por sí solo no significa nada, y
                suelto en la lista se leería como una regla más en vez de como la excepción de
                la de arriba.
              */}
              {riesgo.politica.bloquearConCuotasVencidas && (
                <div className="ml-4 border-l-2 border-border pl-4">
                  <SwitchRow
                    title="…pero un administrador puede autorizarlo igual"
                    desc="Apagado, el freno de arriba no lo levanta nadie. Prendido, el admin puede firmar el otorgamiento asumiendo el riesgo, y queda registrado quién lo autorizó. El vendedor nunca puede."
                    checked={riesgo.politica.permitirOverrideCuotasVencidas}
                    onChange={v => setRiesgo({ permitirOverrideCuotasVencidas: v })}
                  />
                </div>
              )}

              <SwitchRow
                title="Rechazar con cheques rechazados"
                desc="Si el bureau informa cheques rechazados sin regularizar, el cliente no califica."
                checked={riesgo.politica.rechazaConChequesRechazados}
                onChange={v => setRiesgo({ rechazaConChequesRechazados: v })}
              />

              {/* Las dos señales que el BCRA informa por entidad y que hasta ahora se
                  descartaban. El juicio va por el camino del rechazo justamente para que lo
                  alcance "Si el cliente no califica": con esa opción en "autorizar", no
                  bloquea — lo frena hasta que un admin lo asuma. */}
              <SwitchRow
                title="Rechazar con proceso judicial"
                desc="Si alguna entidad le inició juicio o lo informa en situación jurídica, el cliente no califica. Con «Avisar y dejar autorizar» no se bloquea: lo tiene que autorizar un administrador."
                checked={riesgo.politica.rechazaConJuicio}
                onChange={v => setRiesgo({ rechazaConJuicio: v })}
              />

              <SwitchRow
                title="Revisar si refinanció en otra entidad"
                desc="No lo descalifica, pero cambia el caso: es alguien que no pudo con su plan original. Queda en revisión."
                checked={riesgo.politica.revisaConRefinanciaciones}
                onChange={v => setRiesgo({ revisaConRefinanciaciones: v })}
              />

              {/* ── Bureau de crédito (integración por API) — PREMIUM (plan Pro) ── */}
              <FeatureGate feature="bureau_credito">
              <div className="border-t border-border pt-4">
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1">Bureaus de crédito (verificación externa · Pro)</p>
                {/*
                  🔴 ANTES ERA UN DESPLEGABLE: un solo bureau por financiera.
                  Así no se trabaja — se consulta el BCRA, que es gratis, Y ADEMÁS un bureau
                  comercial, a veces dos para comparar. Con un solo slot había que venir acá
                  a cambiar el proveedor cada vez que se quería la otra fuente.
                  Ahora es un bloque por bureau, cada uno se prende por separado, y los que
                  queden activos aparecen como opción en la ficha del cliente.
                */}
                <p className="mb-3 text-[11px] text-muted-foreground/70">Los que actives aparecen para consultar en la ficha del cliente.</p>

                <div className="space-y-3">
                  {BUREAUS_CONFIGURABLES.map((clave) => {
                    const cfg = proveedoresBureau[clave];
                    const pide = BUREAU_REQUIERE_CREDENCIALES[clave];
                    return (
                      <div key={clave} className={`rounded-xl border p-3.5 transition-colors ${cfg.activo ? "border-primary/30 bg-primary/5" : "border-border bg-muted/10"}`}>
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-foreground">{BUREAU_LABEL[clave]}</p>
                            <p className="text-[11px] text-muted-foreground/70">
                              {clave === "bcra"
                                ? "API pública y gratuita. No requiere credenciales."
                                : "Servicio pago: hace falta contratarlo y cargar las credenciales."}
                            </p>
                          </div>
                          <Toggle checked={cfg.activo} onChange={v => setProveedorBureau(clave, { activo: v })} />
                        </div>

                        {/* Las credenciales solo cuando el bureau está prendido y las pide. */}
                        {cfg.activo && pide && (
                          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                            <Field label="Endpoint (URL base)">
                              <Input placeholder="https://api.proveedor.com" value={cfg.endpoint ?? ""}
                                onChange={e => setProveedorBureau(clave, { endpoint: e.target.value })} />
                            </Field>
                            <Field label="Usuario (si aplica)">
                              <Input placeholder="usuario" value={cfg.usuario ?? ""}
                                onChange={e => setProveedorBureau(clave, { usuario: e.target.value })} />
                            </Field>
                            <Field label="Token / API key" hint="Secreto: se guarda enmascarado">
                              <SecretInput placeholder="••••••••" value={cfg.token ?? ""}
                                onChange={e => setProveedorBureau(clave, { token: e.target.value })} />
                            </Field>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                <div className="mt-4">
                  <Field label="Consulta automática al evaluar" hint="Además de poder consultar a mano desde la ficha del cliente.">
                    <div className="flex h-10 items-center">
                      <Toggle checked={riesgo.bureau.enabled} onChange={v => setBureau({ enabled: v })} />
                    </div>
                  </Field>
                </div>
              </div>
              </FeatureGate>
            </div>
          </Section>
          )}

          {/* ─── Notificaciones in-app (campanita) ─── */}
          {activeTab === "notificaciones" && (
          <Section
            title="Notificaciones del sistema"
            desc="Elegí qué avisos aparecen en la campanita. No afecta los mensajes automáticos que se envían a los clientes (eso se maneja en Comunicaciones)."
            ayuda={AYUDA.notificaciones}
            onSave={() => save("notificaciones", { notificacionesConfig: notif } as Partial<ConfiguracionFinanciera>)}
            saving={savingKey === "notificaciones"} saved={savedKey === "notificaciones"} dirty={isDirty("notificaciones")}
          >
            <div className="space-y-3">
              <NotifRow
                title="Movimientos de caja"
                desc="Cobros, desembolsos y demás movimientos, en vivo. Lo ven todos los roles."
                checked={notif.movimientos_caja}
                onChange={v => setNotif({ movimientos_caja: v })}
              />
              <NotifRow
                title="Respaldos"
                desc="Aviso si un backup falla o se atrasa. Solo administradores."
                checked={notif.respaldos}
                onChange={v => setNotif({ respaldos: v })}
              />
              <NotifRow
                title="Plan y facturación"
                desc="Avisos de vencimiento del plan. Solo administradores."
                checked={notif.plan}
                onChange={v => setNotif({ plan: v })}
              />
            </div>
          </Section>
          )}

          {/* ─── Documentos del crédito (solicitud/mutuo + pagaré) ─── */}
          {activeTab === "cobranza" && <>
          {/*
            Va PRIMERO en la pestana: decide QUIEN puede cobrar, que es mas de fondo que
            como se ordena la cola del dia.
          */}
          <Section title="Quien puede cobrar" desc="Si un agente puede cobrarle a un cliente de otro agente." ayuda={AYUDA.cobranza}
            onSave={() => save("cobranza", { cobranzaConfig: cobranza })}
            saving={savingKey === "cobranza"} saved={savedKey === "cobranza"} dirty={isDirty("cobranza")}>
            <SwitchRow
              title="Cobranza abierta"
              desc="Cualquier agente le puede cobrar a cualquier cliente y ver el credito con su plan de cuotas. La plata entra a la caja de quien cobra; el recupero se le sigue acreditando al agente dueno del credito. Apagado, cada uno cobra solo lo suyo y un cliente no puede pagar si su agente no esta."
              checked={cobranza.cobranza_abierta}
              onChange={v => setCobranza({ cobranza_abierta: v })}
            />
          </Section>

          {/* Agenda de cobranza */}
          <Section title="Agenda de cobranza" desc="Cada cuántos días un moroso sin gestionar vuelve a aparecer en la cola del día, y con qué criterio se ordena." ayuda={AYUDA.cobranza}
            onSave={() => save("cobranza", { cobranzaConfig: cobranza })}
            saving={savingKey === "cobranza"} saved={savedKey === "cobranza"} dirty={isDirty("cobranza")}>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 max-w-xl">
              <Field label="Días sin gestión" hint="Un moroso reaparece en la agenda si nadie lo contactó en esta cantidad de días (1–90).">
                <NumeroInput min="1" max="90" decimales={false}
                  value={cobranza.dias_sin_gestion}
                  onValueChange={v => setCobranza({ dias_sin_gestion: Math.max(1, Math.min(90, Math.round(v))) })}
                />
              </Field>
              {/*
                Los GRUPOS (promesa → agendado → enfriado) no se tocan: eso es urgencia. Lo
                que se elige es el orden ADENTRO de cada grupo, que es donde estaba la
                decisión escondida: ordenando por días, el que más plata debe quedaba al
                final de la lista, y en una cola que nadie llama entera el último no se llama.
              */}
              <Field label="A quién llamar primero" hint={ORDENES_AGENDA_UI.find(o => o.key === cobranza.orden)?.consecuencia ?? ""}>
                <Select
                  value={cobranza.orden}
                  onChange={e => setCobranza({ orden: e.target.value as OrdenAgenda })}
                >
                  {ORDENES_AGENDA_UI.map(o => (
                    <option key={o.key} value={o.key}>{o.label}</option>
                  ))}
                </Select>
              </Field>
            </div>
          </Section>

          {/* Tramos de mora */}
          <Section
            title="Tramos de mora"
            desc="Dónde corta cada nivel de gravedad según los días de atraso. Es la escala que usan el Home y Reportes."
            ayuda={AYUDA.tramosMora}
            onSave={() => save("cobranza", { cobranzaConfig: cobranza })}
            saving={savingKey === "cobranza"} saved={savedKey === "cobranza"} dirty={isDirty("cobranza")}
          >
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 max-w-xl">
              <Field label="Mora media, hasta" hint={`De 1 a ${cobranza.tramos_mora.media_hasta} días de atraso.`}>
                <Input
                  type="number" min="1" step="1"
                  value={cobranza.tramos_mora.media_hasta}
                  onChange={e => {
                    const media = Math.max(1, Math.round(parseFloat(e.target.value) || 1));
                    // La alta no puede quedar por debajo de la media: el tramo intermedio
                    // desaparecería y todos saltarían de media a crítica sin escala.
                    setCobranza({ tramos_mora: { media_hasta: media, alta_hasta: Math.max(media + 1, cobranza.tramos_mora.alta_hasta) } });
                  }}
                />
              </Field>
              <Field
                label="Mora alta, hasta"
                hint={`De ${cobranza.tramos_mora.media_hasta + 1} a ${cobranza.tramos_mora.alta_hasta} días. De ahí en más es crítica.`}
              >
                <Input
                  type="number" min={cobranza.tramos_mora.media_hasta + 1} step="1"
                  value={cobranza.tramos_mora.alta_hasta}
                  onChange={e => setCobranza({
                    tramos_mora: {
                      media_hasta: cobranza.tramos_mora.media_hasta,
                      alta_hasta: Math.max(cobranza.tramos_mora.media_hasta + 1, Math.round(parseFloat(e.target.value) || 1)),
                    },
                  })}
                />
              </Field>
            </div>
            {/* La escala resultante, escrita: son dos números que definen tres tramos, y sin
                verlos armados hay que hacer la cuenta de cabeza cada vez. */}
            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
              <span className="rounded-lg border border-warning/30 bg-warning/10 px-2.5 py-1 text-warning">
                Media · 1 a {cobranza.tramos_mora.media_hasta} días
              </span>
              <span className="rounded-lg border border-destructive/25 bg-destructive/10 px-2.5 py-1 text-destructive">
                Alta · {cobranza.tramos_mora.media_hasta + 1} a {cobranza.tramos_mora.alta_hasta} días
              </span>
              <span className="rounded-lg border border-destructive/40 bg-destructive/20 px-2.5 py-1 font-semibold text-destructive">
                Crítica · más de {cobranza.tramos_mora.alta_hasta} días
              </span>
            </div>
          </Section>

          {/* Acuerdos de pago */}
          <Section title="Acuerdos de pago" desc="El arreglo informal en cuotas con un moroso: hasta cuántas cuotas, qué lo rompe y quién puede condonar." ayuda={AYUDA.acuerdos}
            onSave={() => save("cobranza", { cobranzaConfig: cobranza })}
            saving={savingKey === "cobranza"} saved={savedKey === "cobranza"} dirty={isDirty("cobranza")}>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 max-w-3xl">
              <Field required label="Máximo de cuotas" advertencia={advertirCuotasAcuerdo(cobranza.acuerdos.max_cuotas)} hint="El techo del vendedor: hasta en cuántos pagos puede repartir lo vencido sin consultar. Con 6 puede ofrecer 6, no 8.">
                <NumeroInput min="1" max="60" decimales={false}
                  value={cobranza.acuerdos.max_cuotas}
                  onValueChange={v => setAcuerdos({ max_cuotas: Math.max(1, Math.min(60, Math.round(v))) })}
                />
              </Field>
              <Field required label="Días entre cuotas" hint="Cada cuánto vence una cuota del acuerdo: 30 = mensual · 15 = quincenal · 7 = semanal. No depende de la frecuencia del crédito.">
                <NumeroInput min="1" max="365" decimales={false}
                  value={cobranza.acuerdos.dias_entre_cuotas}
                  onValueChange={v => setAcuerdos({ dias_entre_cuotas: Math.max(1, Math.min(365, Math.round(v))) })}
                />
              </Field>
              <Field label="Cuotas impagas que lo rompen" hint="Con 1 se cae al primer faltazo; con 2 o 3 tolerás un tropiezo. Al romperse vuelve a morosos y los punitorios corren de nuevo.">
                <NumeroInput min="1" decimales={false}
                  value={cobranza.acuerdos.cuotas_para_romper}
                  onValueChange={v => setAcuerdos({ cuotas_para_romper: Math.max(1, Math.round(v)) })}
                />
              </Field>
              {/*
                🔴 QUÉ PASA CON EL INTERÉS DEL ACUERDO. Va ANTES que la tasa porque la manda:
                el modo `sin_interes` la deja en 0 sin importar lo que diga el campo de abajo.

                Existe porque sin él el acuerdo con interés NO SE PODÍA TERMINAR DE COBRAR: ese
                interés no era un renglón de ninguna cuota del crédito, así que al cobrar la
                última no había contra qué imputarlo y el pago se rechazaba por sobrepago. El
                cliente pagaba todo lo que el crédito debía y el acuerdo igual quedaba con
                saldo, hasta que el cron lo marcaba roto. Las tres salidas son legítimas y
                ninguna es "la correcta", así que la elige cada financiera.
              */}
              <Field
                label="El interés del acuerdo"
                hint={MODO_INTERES_LABEL[cobranza.acuerdos.modo_interes].detalle}
              >
                <Select
                  value={cobranza.acuerdos.modo_interes}
                  onChange={e => setAcuerdos({ modo_interes: e.target.value as ModoInteresAcuerdo })}
                >
                  {MODOS_INTERES_ACUERDO.map((m) => (
                    <option key={m} value={m}>{MODO_INTERES_LABEL[m].titulo}</option>
                  ))}
                </Select>
              </Field>
              {/*
                🔴 ACÁ `null` NO ES `0`, Y NO SE PUEDEN JUNTAR.
                  null → el acuerdo usa la MISMA tasa que firmó el cliente (`resolverTasaAcuerdo`)
                  0    → el acuerdo NO devenga interés: refinanciarse sale gratis
                Mostrar 0 cuando el valor es null —como sí se hace con el día de corte, donde
                el motor los trata igual— convertiría todos los acuerdos en gratuitos de un
                día para el otro. Así que en vez de un número que a veces está vacío, el modo
                se elige explícito: nunca hay un campo mudo, y las dos opciones se leen.
              */}
              <Field
                label="Tasa del acuerdo"
                hint={sinInteres
                  ? "No aplica: el modo de arriba dice que este acuerdo no cobra interés."
                  : "Con la tasa del crédito, el acuerdo le cuesta lo mismo que ya firmó. Con tasa propia en 0 no devenga interés: atrasarse conviene."}
              >
                <Select
                  disabled={sinInteres}
                  value={cobranza.acuerdos.tasa_mensual === null || cobranza.acuerdos.tasa_mensual === undefined ? "credito" : "propia"}
                  onChange={e => setAcuerdos({ tasa_mensual: e.target.value === "credito" ? null : 0 })}
                >
                  <option value="credito">La misma del crédito</option>
                  <option value="propia">Tasa propia (% mensual)</option>
                </Select>
              </Field>
              <Field
                label="% mensual del acuerdo"
                advertencia={sinInteres ? null : advertirTasaAcuerdo(cobranza.acuerdos.tasa_mensual)}
                hint={sinInteres
                  ? "No aplica: el modo de arriba dice que este acuerdo no cobra interés."
                  : cobranza.acuerdos.tasa_mensual === null || cobranza.acuerdos.tasa_mensual === undefined
                  ? "Lo define la tasa de cada crédito."
                  : cobranza.acuerdos.tasa_mensual === 0
                  ? "En 0: el acuerdo no devenga interés."
                  : "Se aplica a todos los acuerdos, sea cual sea la tasa del crédito."}
              >
                <NumeroInput min="0" max="100" disabled={sinInteres || cobranza.acuerdos.tasa_mensual === null || cobranza.acuerdos.tasa_mensual === undefined}
                  value={cobranza.acuerdos.tasa_mensual ?? 0}
                  onValueChange={v => setAcuerdos({ tasa_mensual: Math.max(0, Math.min(100, v)) })}
                />
              </Field>
              <Field label="Descuento máx. del vendedor (%)" hint="Cuánto de los punitorios e interés puede perdonar el vendedor por su cuenta. En 0 no descuenta nada: todo descuento lo firma un admin, que no tiene tope. El capital nunca se toca.">
                <NumeroInput min="0" max="100" decimales={false}
                  value={cobranza.acuerdos.quita_max_vendedor_pct}
                  onValueChange={v => setAcuerdos({ quita_max_vendedor_pct: Math.max(0, Math.min(100, v)) })}
                />
              </Field>
            </div>
            <div className="mt-4 flex flex-col gap-3 max-w-3xl">
              <SwitchRow
                title="Congelar punitorios mientras cumple"
                desc="El incentivo para el deudor: si paga lo acordado, no se le sigue sumando mora."
                checked={cobranza.acuerdos.congela_punitorios}
                onChange={v => setAcuerdos({ congela_punitorios: v })}
              />
              <SwitchRow
                title="Sacarlo de la agenda del día mientras cumple"
                desc="Quien está cumpliendo ya está gestionado. Llamarlo igual suele ser la forma más rápida de que deje de cumplir."
                checked={cobranza.acuerdos.saca_de_agenda}
                onChange={v => setAcuerdos({ saca_de_agenda: v })}
              />
              {/* La decisión de QUÉ ES un acuerdo. Va acá y no fija en el código porque las
                  dos posturas son defendibles según el plazo del crédito que se preste. */}
              <SwitchRow
                title="El acuerdo se lleva todo el crédito"
                desc={
                  cobranza.acuerdos.incluye_no_vencidas
                    ? "El plan original se cae: se juntan las cuotas vencidas y las que faltan vencer en un solo compromiso, y al terminarlo el crédito queda saldado."
                    : "El acuerdo arregla solo el atraso. Lo que todavía no venció sigue su plan, así que el cliente queda con dos compromisos en paralelo."
                }
                checked={cobranza.acuerdos.incluye_no_vencidas}
                onChange={v => setAcuerdos({ incluye_no_vencidas: v })}
              />
            </div>
          </Section>

          {/* Clientes fallecidos */}
          <Section
            title="Clientes fallecidos"
            desc="Qué hace el sistema con la deuda de alguien que falleció, mientras la financiera decide si la condona o va a la sucesión."
            ayuda={AYUDA.fallecidos}
            onSave={() => save("cobranza", { cobranzaConfig: cobranza })}
            saving={savingKey === "cobranza"} saved={savedKey === "cobranza"} dirty={isDirty("cobranza")}
          >
            <div className="flex flex-col gap-3 max-w-3xl">
              <SwitchRow
                title="Frenar los punitorios"
                desc="La mora deja de correr el día del fallecimiento — todas las cuotas, también las que vencen después. Nadie iba a poder pagarlas."
                checked={cobranza.fallecidos.frena_punitorios}
                onChange={v => setFallecidos({ frena_punitorios: v })}
              />
              <SwitchRow
                title="Bloquear el contacto"
                desc="No se le manda WhatsApp ni email, ni entra en campañas. El mensaje lo recibiría la familia, a nombre del fallecido."
                checked={cobranza.fallecidos.bloquea_contacto}
                onChange={v => setFallecidos({ bloquea_contacto: v })}
              />
              <SwitchRow
                title="Sacarlo de la agenda del día"
                desc="Apagalo si tu financiera igual gestiona con los herederos."
                checked={cobranza.fallecidos.saca_de_agenda}
                onChange={v => setFallecidos({ saca_de_agenda: v })}
              />
            </div>
          </Section>

          {/* Plantillas del contacto individual */}
          <Section
            title="Mensajes al cliente"
            desc="Lo que se le manda por WhatsApp o email desde la ficha, según el motivo."
            ayuda={AYUDA.plantillas}
            onSave={() => save("cobranza", { cobranzaConfig: cobranza })}
            saving={savingKey === "cobranza"} saved={savedKey === "cobranza"} dirty={isDirty("cobranza")}
          >
            <PlantillasContactoEditor valor={cobranza.contacto} onChange={setContacto} />
          </Section>

          {/* Plantillas aprobadas por Meta (WhatsApp Business) */}
          <Section
            title="Plantillas aprobadas por Meta"
            desc="Las que Meta ya aprobó para WhatsApp Business. Opcionales: sin ellas se manda texto libre y el sistema avisa del riesgo."
            ayuda={AYUDA.plantillas_meta}
            onSave={() => save("cobranza", { cobranzaConfig: cobranza })}
            saving={savingKey === "cobranza"} saved={savedKey === "cobranza"} dirty={isDirty("cobranza")}
          >
            <PlantillasMetaEditor
              valor={cobranza.plantillas_meta}
              onChange={(plantillas_meta) => setCobranza({ plantillas_meta })}
            />
          </Section>


          {/* Escalera de recupero */}
          <Section
            title="Escalera de recupero"
            desc="Si hay que agotar lo blando antes de lo irreversible: promesa → acuerdo → refinanciación."
            ayuda={AYUDA.escalera}
            onSave={() => save("cobranza", { cobranzaConfig: cobranza })}
            saving={savingKey === "cobranza"} saved={savedKey === "cobranza"} dirty={isDirty("cobranza")}
          >
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 max-w-xl">
              <Field
                label="Pasa a LEGALES a los… (días de atraso)"
                hint={
                  cobranza.recupero.dias_min_mora_acuerdo > 0
                    ? `A los ${cobranza.recupero.dias_min_mora_acuerdo} días el crédito se muestra en azul como "Legales", y recién ahí se le puede armar un acuerdo de pago.`
                    : "0 = ningún crédito pasa a Legales y se puede acordar desde el primer día de atraso."
                }
              >
                <NumeroInput min="0" max="365" decimales={false}
                  value={cobranza.recupero.dias_min_mora_acuerdo}
                  onValueChange={v => setRecupero({ dias_min_mora_acuerdo: Math.max(0, Math.min(365, Math.round(v))) })}
                />
              </Field>
              <Field label="Días mínimos de atraso para refinanciar" hint="La refinanciación mata el crédito y crea otro: conviene reservarla para el atraso grande. 0 = sin mínimo.">
                <NumeroInput min="0" max="365" decimales={false}
                  value={cobranza.recupero.dias_min_mora_refinanciar}
                  onValueChange={v => setRecupero({ dias_min_mora_refinanciar: Math.max(0, Math.min(365, Math.round(v))) })}
                />
              </Field>
            </div>
            <div className="mt-4 flex flex-col gap-3 max-w-3xl">
              <SwitchRow
                title="Exigir haberlo contactado antes de armar un acuerdo"
                desc="Sin al menos una gestión registrada, no se puede acordar. Evita el acuerdo de escritorio, armado sin hablar con el deudor."
                checked={cobranza.recupero.exigir_gestion_para_acuerdo}
                onChange={v => setRecupero({ exigir_gestion_para_acuerdo: v })}
              />
              <SwitchRow
                title="No refinanciar por debajo de la tasa original"
                desc="Bajar la tasa al refinanciar es una condonación encubierta: no queda registrada como quita ni respeta su tope. Sobre una deuda de $221.000 a 3 cuotas, pasar de 60% a 20% regala unos $15.000. Subirla sigue libre, y un administrador puede autorizar la baja igual."
                checked={cobranza.recupero.no_bajar_tasa_refinanciando}
                onChange={v => setRecupero({ no_bajar_tasa_refinanciando: v })}
              />
              <SwitchRow
                title="Exigir un acuerdo roto antes de refinanciar"
                desc="Obliga a agotar lo reversible primero. Un acuerdo que se rompe deja el crédito como estaba; una refinanciación no se deshace, y además le descuenta 25 puntos de score al cliente."
                checked={cobranza.recupero.exigir_acuerdo_para_refinanciar}
                onChange={v => setRecupero({ exigir_acuerdo_para_refinanciar: v })}
              />
            </div>
          </Section>
          </>}

          {activeTab === "cajas" && (
          <Section
            title="Control de las cajas"
            desc="Quién puede sacar plata sin que la firme un administrador, y hasta cuándo se puede deshacer un cobro."
            ayuda={AYUDA.cajas}
            onSave={() => save("cajas", { cajaConfig: caja })}
            saving={savingKey === "cajas"} saved={savedKey === "cajas"} dirty={isDirty("cajas")}
          >
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 max-w-xl">
              <Field
                label="Gasto máximo del vendedor ($)"
                hint="Cuánto puede descontar de su propia caja sin que lo apruebes. En 0 no registra ninguno: se los cargás vos."
              >
                <NumeroInput min="0"
                  value={caja.tope_gasto_vendedor}
                  onValueChange={v => setCaja({ tope_gasto_vendedor: Math.max(0, v) })}
                />
              </Field>
              <Field
                label="Días para anular un cobro"
                hint="Pasado este plazo desde que se registró, el cobro queda firme y solo se corrige con un ajuste de caja (0 = solo el mismo día)."
              >
                <NumeroInput min="0" max="365" decimales={false}
                  value={caja.dias_anulacion_pago}
                  onValueChange={v => setCaja({ dias_anulacion_pago: Math.max(0, Math.min(365, Math.round(v))) })}
                />
              </Field>
            </div>
          </Section>
          )}

          {activeTab === "documentos" && (
          <Section
            title="Documentos del crédito"
            desc="Lo que se imprime en la solicitud de préstamo y en el pagaré. Se define una vez; los datos de cada operación los completa el sistema."
            ayuda={AYUDA.documentos}
            onSave={() => save("documentos", { documentosConfig: docs } as Partial<ConfiguracionFinanciera>)}
            saving={savingKey === "documentos"} saved={savedKey === "documentos"} dirty={isDirty("documentos")}
          >
            <div className="space-y-4">
              {/* 🔴 Esta pestaña está construida y NO tiene consumidor todavía: no hay
                  generador de pagaré. Sin este cartel, quien la complete espera un papel que
                  el sistema no imprime, y lo lee como una función rota. Sacarlo el día que
                  exista el documento (C1 en PENDIENTES.md). */}
              <div className="rounded-lg border border-primary/30 bg-primary/[0.07] px-4 py-3">
                <p className="text-xs leading-relaxed text-foreground">
                  <span className="font-semibold">El documento todavía no se imprime.</span>{" "}
                  Esta sección ya guarda tus condiciones y las va a usar el pagaré cuando esté
                  listo. Mientras tanto, seguí usando el que usás hoy: lo que cargues acá queda
                  guardado y no hay que volver a escribirlo.
                </p>
              </div>

              {/* Avisos de configuración que dejaría un documento débil. No bloquean:
                  puede haber razones para emitir así, pero que sea a sabiendas. */}
              {avisosDocs.length > 0 && (
                <div className="rounded-lg border border-warning/30 bg-warning/[0.07] px-4 py-3 space-y-1.5">
                  {avisosDocs.map(a => (
                    <p key={a.campo} className="text-xs leading-relaxed text-warning">{a.mensaje}</p>
                  ))}
                </div>
              )}

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Jurisdicción" hint="Ante qué tribunales se reclama">
                  <Input
                    value={docs.jurisdiccion}
                    onChange={e => setDocs({ jurisdiccion: e.target.value })}
                    placeholder="Ej: Tribunales Ordinarios de San Miguel de Tucumán"
                  />
                </Field>
                {/* DERIVADO, no editable. Antes era un número suelto que podía no coincidir
                    con lo que el motor cobra de verdad — y en un pagaré firmado gana lo que
                    dice el papel. Ahora sale de la tasa diaria; se cambia donde se cobra. */}
                <Field
                  label="Interés punitorio mensual (%)"
                  hint="Sale de la tasa de mora que cobra el sistema. Para cambiarlo: Motor financiero → Interés por mora."
                >
                  <div className="relative">
                    <Input
                      type="text" readOnly tabIndex={-1}
                      value={punitorioMensual.toLocaleString("es-AR", { maximumFractionDigits: 2 })}
                      className="font-mono tabular-nums opacity-70 cursor-not-allowed"
                    />
                    <Percent className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
                  </div>
                </Field>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Pagaré" hint="Cómo se emite">
                  <Select value={docs.modo_pagare} onChange={e => setDocs({ modo_pagare: e.target.value as DocumentosConfig["modo_pagare"] })}>
                    <option value="con_monto">Con monto impreso</option>
                    <option value="sin_monto">Sin monto (se completa al ejecutarlo)</option>
                  </Select>
                </Field>
                <Field label="Caducidad de plazos" hint="Cuotas impagas que vuelven exigible el total (0 = sin caducidad)">
                  <Input
                    type="number" min="0" max="24" step="1"
                    value={String(docs.cuotas_caducidad)}
                    onChange={e => setDocs({ cuotas_caducidad: parseInt(e.target.value) || 0 })}
                    className="font-mono tabular-nums"
                  />
                </Field>
              </div>

              <div className="space-y-3">
                <NotifRow
                  title="Sin protesto"
                  desc="Evita el trámite notarial previo a ejecutar el pagaré."
                  checked={docs.sin_protesto}
                  onChange={v => setDocs({ sin_protesto: v })}
                />
                <NotifRow
                  title={`Ampliar la presentación del pagaré a ${docs.anios_presentacion} años`}
                  desc="Art. 36 Dec. Ley 5965/63. Sin esta cláusula, el plazo para presentar un pagaré a la vista es mucho más corto."
                  checked={docs.anios_presentacion >= 5}
                  onChange={v => setDocs({ anios_presentacion: v ? 5 : 1 })}
                />
                <NotifRow
                  title="Actualizar por IPC del INDEC"
                  desc="Además del punitorio, ajusta la deuda por inflación."
                  checked={docs.actualiza_por_ipc}
                  onChange={v => setDocs({ actualiza_por_ipc: v })}
                />
                <NotifRow
                  title="Autorización a pedir informes"
                  desc="El cliente autoriza a consultar e informar su comportamiento de pago a bureaus y terceros."
                  checked={docs.incluye_autorizacion_informes}
                  onChange={v => setDocs({ incluye_autorizacion_informes: v })}
                />
                <NotifRow
                  title="Cesión de crédito"
                  desc="Permite vender la cartera a un tercero. Activalo solo si la financiera lo hace."
                  checked={docs.incluye_cesion_credito}
                  onChange={v => setDocs({ incluye_cesion_credito: v })}
                />
                <NotifRow
                  title="Entidad autorizada por el BCRA"
                  desc="Se imprime en el encabezado. Activalo SOLO si la financiera tiene la autorización: declararlo sin tenerla es una infracción grave."
                  checked={docs.autorizada_bcra}
                  onChange={v => setDocs({ autorizada_bcra: v })}
                />
              </div>

              <Field label="Cláusulas adicionales" hint="Texto libre que se agrega al final. Opcional.">
                <Textarea
                  rows={4}
                  value={docs.clausulas_extra}
                  onChange={e => setDocs({ clausulas_extra: e.target.value })}
                  placeholder="Cláusulas propias de la financiera que no estén contempladas arriba."
                />
              </Field>
            </div>
          </Section>
          )}

          {/* ─── Respaldos (backups) ─── */}
          {activeTab === "backups" && <BackupsView />}

            </div>{/* /contenido */}
          </div>{/* /grid rail+contenido */}
        </div>
      )}
    </div>
  );
}

function defaultRentabilidad(): RentabilidadConfig {
  return { habilitado: false, costo_fondeo_anual: 0, otros_costos_mensuales: 0 };
}

function defaultCobranza(): CobranzaConfig {
  return {
    dias_sin_gestion: 7,
    // Los mismos valores con los que venía funcionando: activar el parámetro no mueve nada.
    tramos_mora: { media_hasta: 15, alta_hasta: 30 },
    orden: "mora",
    cobranza_abierta: true,
    contacto: PLANTILLAS_CONTACTO_DEFAULT,
    plantillas_meta: [],
    acuerdos: {
      max_cuotas: 6, dias_entre_cuotas: 30, cuotas_para_romper: 1,
      congela_punitorios: true, saca_de_agenda: true, incluye_no_vencidas: true,
      quita_max_vendedor_pct: 0, tasa_mensual: null, modo_interes: "capitaliza",
    },
    recupero: {
      exigir_gestion_para_acuerdo: false, dias_min_mora_acuerdo: 50,
      exigir_acuerdo_para_refinanciar: false, dias_min_mora_refinanciar: 0,
      no_bajar_tasa_refinanciando: true,
    },
    fallecidos: { frena_punitorios: true, bloquea_contacto: true, saca_de_agenda: true },
  };
}

function defaultCaja(): CajaConfig {
  return { tope_gasto_vendedor: 0, dias_anulacion_pago: 3 };
}

function defaultNotificaciones(): NotificacionesConfig {
  return { movimientos_caja: true, respaldos: true, plan: true };
}

/**
 * Fila de un ajuste de encendido/apagado.
 *
 * El estado se lee en TRES señales a la vez: el fondo teñido, la etiqueta "Activo/Inactivo"
 * y la perilla. Suena redundante y no lo es — en un bloque con seis ajustes, lo que se busca
 * de un vistazo es cuáles están prendidos, y eso se ve en el fondo mucho antes que en seis
 * perillas del mismo tamaño.
 *
 * Este look ya existía repetido a mano en seis lugares del formulario; acá queda en uno solo
 * para que no se despeguen entre sí.
 */
function SwitchRow({ title, desc, checked, onChange }: { title: string; desc?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className={`flex items-center justify-between gap-3 rounded-lg border border-border px-4 py-3 transition-colors ${checked ? "bg-primary/[0.06] ring-1 ring-inset ring-primary/25" : "bg-muted/30"}`}>
      <div className="min-w-0">
        <p className="text-sm font-medium text-foreground">{title}</p>
        {desc && <p className="text-xs text-muted-foreground">{desc}</p>}
      </div>
      <Toggle checked={checked} onChange={onChange} />
    </div>
  );
}

/** Aviso de la campanita: es un `SwitchRow` con nombre propio para que se lea en su bloque. */
function NotifRow({ title, desc, checked, onChange }: { title: string; desc: string; checked: boolean; onChange: (v: boolean) => void }) {
  return <SwitchRow title={title} desc={desc} checked={checked} onChange={onChange} />;
}

function defaultRiesgo(): RiesgoConfig {
  return {
    politica: {
      ratioCuotaIngresoMax: 0.30,
      ingresoDisponibleMinPct: 0, // apagado por defecto: no cambia el criterio de nadie
      multiploIngresoMax: 6,
      limiteBaseSinBureau: 0,
      situacionBcraMax: 2,
      scoreExternoMin: null,
      rechazaConChequesRechazados: true,
      rechazaConJuicio: true,
      revisaConRefinanciaciones: false,
      maxCreditosActivos: 0,
      maxEdicionesSueldoVendedor: 3,
      alertaSaltoSueldoPct: 50,
      bloquearConCuotasVencidas: true,
      permitirOverrideCuotasVencidas: false,
      accionSinIngreso: "autorizar",
      accionAlNoCalificar: "autorizar",
    },
    bureau: { proveedor: "manual", enabled: false, endpoint: "", token: "", usuario: "" },
  };
}

function defaultGamificacion(): GamificacionConfig {
  return {
    habilitado: true,
    periodo: "mensual",
    pesos: { monto: 50, cantidad: 30, cobranza: 20, calidad: 0 },
    umbrales: { oro: 100, plata: 85, bronce: 70 },
  };
}

function CanalesBlock({ icon, title, enabled, onToggle, children, onSave, saving, saved, dirty, ayuda }: {
  icon: React.ReactNode; title: string; enabled: boolean; onToggle: (v: boolean) => void; children: React.ReactNode;
  onSave?: () => void; saving?: boolean; saved?: boolean; dirty?: boolean; ayuda?: AyudaBloque;
}) {
  return (
    <div className="rounded-lg border border-border bg-muted/30 p-4 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.03)]">
      <div className="flex items-center justify-between gap-3 mb-1">
        <div className="flex items-center gap-2">
          {icon}
          <p className="text-sm font-medium text-foreground">{title}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {ayuda && <HelpHint ayuda={ayuda} />}
          <Toggle checked={enabled} onChange={onToggle} />
          {onSave && <SaveButton saving={!!saving} saved={!!saved} dirty={dirty} onClick={onSave} />}
        </div>
      </div>
      <div className={enabled ? "" : "pointer-events-none opacity-40"}>{children}</div>
    </div>
  );
}

function eventoLabel(evento: string): string {
  return { recordatorio: "Recordatorio (3d antes)", vencimiento: "Vencimiento hoy", mora_temprana: "Mora temprana (5d)", mora_media: "Mora media (15d)", mora_critica: "Mora crítica (30d+)" }[evento] ?? evento;
}

function defaultWhatsapp() { return { enabled: false, token: "", phone_number_id: "", business_account_id: "", templates: {} }; }
function defaultSms()       { return { enabled: false, api_key: "", provider: "twilio" }; }
function defaultEmail()     { return { enabled: false, provider: "smtp", host: "", port: 587, user: "", pass: "" }; }

/**
 * Sub-título dentro de un bloque, para separar campos que hacen cosas distintas.
 *
 * Nace de que "monto máximo" y "monto por defecto" se leían igual de importantes en una
 * grilla plana, cuando uno LIMITA y el otro solo PROPONE. Agrupar es más barato que explicar.
 */
/**
 * Rótulo corto de la convención de tasa, el mismo que muestra el simulador debajo del campo.
 * Sin esto, "Tasa: 50" no dice si son 50 mensual o 50 anual — y la diferencia es enorme.
 */
const CONV_CORTA: Record<ConfiguracionFinanciera["convencionTasa"], string> = {
  nominal_anual: "T.N.A.",
  efectiva_anual: "T.E.A.",
  mensual: "T.M.",
};

function SubGrupo({ titulo, nota, children }: { titulo: string; nota?: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-2.5 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <h4 className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">{titulo}</h4>
        {nota && <span className="text-xs text-muted-foreground/60">· {nota}</span>}
      </div>
      {children}
    </div>
  );
}

/**
 * Estado de un parámetro que se apaga con 0.
 *
 * Un campo en 0 se lee exactamente igual que uno sin configurar, así que no había forma de
 * saber si el límite estaba rigiendo. El punto de color lo resuelve de un vistazo, y el texto
 * dice qué pasa en cada caso — sin sumarle largo a la ayuda del bloque.
 */
function EstadoParam({ on, siOn, siOff }: { on: boolean; siOn: string; siOff: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${on ? "bg-success" : "bg-muted-foreground/40"}`} />
      <span className={on ? "font-medium text-success" : "text-muted-foreground/60"}>{on ? siOn : siOff}</span>
    </span>
  );
}

function Section({ title, desc, children, onSave, saving, saved, dirty, enabled, onToggle, ayuda, error }: {
  title: string; desc?: string; children: React.ReactNode;
  onSave?: () => void; saving?: boolean; saved?: boolean; dirty?: boolean;
  /** Motivo por el que el servidor rechazó el último guardado DE ESTE bloque. */
  error?: string;
  /** Si se pasa `onToggle`, la sección muestra un switch de encendido/apagado en la cabecera. */
  enabled?: boolean; onToggle?: (v: boolean) => void;
  /** Ayuda contextual del bloque (botón "?"). */
  ayuda?: AyudaBloque;
}) {
  return (
    <div className="rounded-xl bg-card border border-border p-5 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04)]">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-foreground">{title}</h3>
          {desc && <p className="text-sm text-muted-foreground mt-0.5">{desc}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {ayuda && <HelpHint ayuda={ayuda} />}
          {onToggle && <Toggle checked={!!enabled} onChange={onToggle} />}
          {onSave && <SaveButton saving={!!saving} saved={!!saved} dirty={dirty} onClick={onSave} />}
        </div>
      </div>
      {/*
        Un bloque apagado atenúa su contenido y deja de aceptar clics, igual que los bloques
        de cargos y de canales. Faltaba justamente acá: se podía apagar Mora y seguir
        escribiendo la tasa como si algo fuera a pasar con ese número.
      */}
      {/*
        El motivo del rechazo, pegado al bloque que lo causó. El cartel general vive arriba de
        la pestaña y esta pantalla es larga: un rechazo en Frecuencias, que está al fondo,
        dejaba el aviso fuera de pantalla y el usuario se quedaba mirando unos interruptores
        apagados que en la base seguían encendidos.
      */}
      {error && (
        <div className="mb-4 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <span className="font-semibold">No se guardó.</span> {error}
        </div>
      )}
      {onToggle ? (
        <div className={enabled ? "" : "pointer-events-none select-none opacity-40"}>{children}</div>
      ) : children}
    </div>
  );
}

/**
 * Botón "?" por bloque de configuración. Abre un popover contextual que explica QUÉ
 * configura ese bloque (pedido del cliente: "saber qué configura cada bloque"). Cierra
 * con clic afuera o Escape. El popover se ancla a la derecha del botón; como las cards de
 * config no recortan el overflow, se muestra completo sin necesidad de portal.
 */
export function HelpHint({ ayuda }: { ayuda: AyudaBloque }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onKey); };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-label="¿Qué configura este bloque?"
        aria-expanded={open}
        title="¿Qué configura este bloque?"
        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-colors ${
          open ? "bg-primary/10 text-primary ring-1 ring-inset ring-primary/25" : "text-muted-foreground hover:bg-muted hover:text-foreground"
        }`}
      >
        <HelpCircle className="h-4 w-4" />
      </button>
      {open && (
        /* 🔴 ALTO MÁXIMO + SCROLL PROPIO.
           El globo crecía sin límite: con una ayuda larga se salía de la pantalla y la única
           forma de leer el final era scrollear la PÁGINA, que arrastraba todo el contenido
           de atrás. `overscroll-contain` es la otra mitad del arreglo — sin él, al llegar al
           final del globo el scroll se encadena al fondo y vuelve a moverse la página. */
        <div className="absolute right-0 top-9 z-30 flex max-h-[min(70vh,32rem)] w-80 max-w-[calc(100vw-2rem)] flex-col overflow-y-auto overscroll-contain rounded-xl border border-border bg-card p-3.5 text-left shadow-2xl shadow-black/30">
          <div className="mb-1.5 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-primary">
            <HelpCircle className="h-3.5 w-3.5" /> {ayuda.titulo ?? "Ayuda"}
          </div>
          <p className="text-xs leading-relaxed text-foreground/90">{ayuda.texto}</p>
          {ayuda.ejemplo && (
            <div className="mt-2.5 rounded-lg border border-primary/20 bg-primary/[0.07] p-2.5">
              <p className="mb-1 text-[10px] font-bold uppercase tracking-widest text-primary">Ejemplo</p>
              <p className="text-xs leading-relaxed text-foreground/90">{ayuda.ejemplo}</p>
            </div>
          )}
          {ayuda.puntos && (
            <ul className="mt-2 space-y-1">
              {ayuda.puntos.map((p, i) => (
                <li key={i} className="flex gap-1.5 text-xs leading-relaxed text-muted-foreground">
                  <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-primary/60" />
                  <span>{p}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function SaveButton({ saving, saved, dirty, onClick }: { saving: boolean; saved: boolean; dirty?: boolean; onClick: () => void }) {
  const solid = dirty && !saved && !saving;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={saving}
      className={`flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50 ${
        saved
          ? "bg-success/10 text-success ring-1 ring-inset ring-success/25"
          : solid
          ? "bg-primary text-primary-foreground shadow-[inset_0_1px_0_0_rgba(255,255,255,0.15)] hover:bg-primary/90"
          : "bg-primary/[0.06] text-primary ring-1 ring-inset ring-primary/25 hover:bg-primary/10 hover:ring-primary/40"
      }`}
    >
      {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : saved ? <Check className="h-3.5 w-3.5" /> : null}
      {saving ? "Guardando…" : saved ? "Guardado" : "Guardar"}
    </button>
  );
}

/** Monto de referencia de la vista previa de un plan: "cada $100.000 sale…". */
const MONTO_MUESTRA = 100_000;

/** Identificador nuevo para un plan. Solo tiene que ser estable y único dentro del tenant. */
function nuevoPlanId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `plan-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Editor de PLANES (antes "plazos", que era solo el número de cuotas).
 *
 * Cada fila es una combinación cerrada: nombre, cuotas, frecuencia, y opcionalmente el
 * coeficiente con el que la financiera cotiza (`cuota = monto × coeficiente`) y sus propios
 * gastos administrativos. Un plan sin coeficiente se cotiza con la tasa que se tipea en el
 * simulador — que es como funcionó siempre.
 *
 * La vista previa de cada fila no es decorativa: muestra la cuota que sale y la TASA que el
 * coeficiente representa. Es lo que atrapa el error de tipeo (0,038 donde iba 0,38) en la
 * pantalla de configuración y no en el mostrador.
 */
function PlanesEditor({ planes, frecuencias, convencion, tasaMin, tasaMax, onChange }: {
  planes: SimuladorConfig["plazos"];
  frecuencias: FrecuenciaOpcion[];
  convencion: ConvencionTasa;
  tasaMin: number;
  tasaMax: number;
  onChange: (p: SimuladorConfig["plazos"]) => void;
}) {
  const activas = frecuencias.filter(f => f.activo);
  const patch = (i: number, cambio: Partial<SimuladorConfig["plazos"][number]>) =>
    onChange(planes.map((p, k) => (k === i ? { ...p, ...cambio } : p)));

  const agregar = () => onChange([
    ...planes,
    { id: nuevoPlanId(), cuotas: 1, activo: true, frecuencia: activas[0]?.clave ?? "mensual" },
  ]);

  return (
    <div className="space-y-2">
      {planes.length === 0 && (
        <p className="text-xs text-muted-foreground/60">Todavía no hay planes. Agregá el primero para poder otorgar créditos mensuales.</p>
      )}

      {planes.map((p, i) => {
        const coef = p.coeficiente ?? 0;
        const tasa = coef > 0 ? tasaDesdeCoeficiente(coef, p.cuotas, convencion, p.frecuencia || "mensual", frecuencias) : null;
        const fueraDeRango = tasa !== null && ((tasaMin > 0 && tasa < tasaMin) || (tasaMax > 0 && tasa > tasaMax));
        return (
          <div key={p.id ?? `${p.cuotas}-${p.frecuencia ?? ""}-${i}`}
            className={`rounded-xl border p-3 transition-colors ${p.activo ? "border-border bg-muted/10" : "border-border/60 bg-muted/5 opacity-60"}`}>

            <div className="flex items-center gap-2">
              <Input value={p.nombre ?? ""} onChange={e => patch(i, { nombre: e.target.value })}
                placeholder={textoCuotas(p.cuotas)} className="font-medium" />
              <Toggle checked={p.activo} onChange={v => patch(i, { activo: v })} />
              <button type="button" onClick={() => onChange(planes.filter((_, k) => k !== i))}
                title="Quitar plan" className="shrink-0 rounded-lg p-2 text-muted-foreground/40 hover:bg-destructive/10 hover:text-destructive transition-colors">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-6">
              <Field label="Código">
                <Input value={p.codigo ?? ""} onChange={e => patch(i, { codigo: e.target.value })} placeholder="—" />
              </Field>
              <Field label="Cuotas">
                <Input type="number" min="1" step="1" value={p.cuotas}
                  onChange={e => patch(i, { cuotas: Math.max(1, parseInt(e.target.value) || 1) })}
                  className="text-center font-mono tabular-nums" />
              </Field>
              <Field label="Frecuencia">
                <Select value={p.frecuencia ?? ""} onChange={e => patch(i, { frecuencia: e.target.value || undefined })}>
                  <option value="">Todas</option>
                  {activas.map(f => <option key={f.clave} value={f.clave}>{cap(f.label)}</option>)}
                </Select>
              </Field>
              <Field label="Coeficiente">
                <Input type="number" min="0" step="0.001" value={p.coeficiente ?? ""}
                  onChange={e => {
                    const v = e.target.value.trim();
                    patch(i, { coeficiente: v === "" ? undefined : parseFloat(v) });
                  }}
                  placeholder="por tasa" className="font-mono tabular-nums" />
              </Field>
              <Field label="Gastos adm.">
                <Select value={p.gastos ? p.gastos.modo : ""}
                  onChange={e => patch(i, {
                    gastos: e.target.value ? { modo: e.target.value as "fijo" | "porcentaje", valor: p.gastos?.valor ?? 0 } : undefined,
                  })}>
                  <option value="">Los generales</option>
                  <option value="fijo">$ por cuota</option>
                  <option value="porcentaje">% de la cuota</option>
                </Select>
              </Field>
              <Field label={p.gastos?.modo === "porcentaje" ? "Gastos (%)" : "Gastos ($)"}>
                <Input type="number" min="0" step="0.01" disabled={!p.gastos}
                  value={!p.gastos ? "" : p.gastos.modo === "fijo" ? p.gastos.valor : Number((p.gastos.valor * 100).toFixed(4))}
                  onChange={e => {
                    if (!p.gastos) return;
                    const raw = parseFloat(e.target.value) || 0;
                    patch(i, { gastos: { modo: p.gastos.modo, valor: p.gastos.modo === "fijo" ? raw : raw / 100 } });
                  }}
                  className="font-mono tabular-nums disabled:opacity-40" />
              </Field>
            </div>

            {coef > 0 && (
              <p className={`mt-2.5 text-xs ${fueraDeRango ? "text-destructive" : "text-muted-foreground"}`}>
                Cada <span className="font-mono">{formatMonto(MONTO_MUESTRA, 0)}</span> paga{" "}
                <span className="font-mono font-semibold text-foreground">{formatMonto(MONTO_MUESTRA * coef, 0)}</span> por cuota
                {tasa === null
                  ? " · ⚠ el coeficiente es demasiado bajo para esa cantidad de cuotas (daría tasa negativa)"
                  : <> · equivale a <span className="font-mono font-semibold">{formatNumero(tasa, 2)}%</span> {CONVENCION_SIGLA[convencion]}</>}
                {fueraDeRango && " · fuera del rango de tasa permitido"}
              </p>
            )}
          </div>
        );
      })}

      <button type="button" onClick={agregar}
        className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition-colors">
        <Plus className="h-3.5 w-3.5" /> Agregar plan
      </button>
    </div>
  );
}

/** Editor de feriados (fechas no hábiles). Las fechas se guardan como "YYYY-MM-DD". */
function FeriadosEditor({ feriados, onChange }: { feriados: string[]; onChange: (f: string[]) => void }) {
  const [nuevo, setNuevo] = useState("");
  const add = () => {
    if (!nuevo || feriados.includes(nuevo)) { setNuevo(""); return; }
    onChange([...feriados, nuevo].sort());
    setNuevo("");
  };
  const fmt = (s: string) => formatFecha(`${s}T00:00:00Z`);
  return (
    <div>
      <p className="text-xs font-medium text-muted-foreground mb-2">Feriados (días no hábiles)</p>
      <div className="flex flex-wrap items-center gap-2">
        {feriados.length === 0 && <span className="text-xs text-muted-foreground/60">Sin feriados cargados.</span>}
        {feriados.map(f => (
          <span key={f} className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-muted/30 px-2.5 py-1.5 text-sm text-foreground">
            <span className="tabular-nums">{fmt(f)}</span>
            <button type="button" onClick={() => onChange(feriados.filter(x => x !== f))} title="Quitar" className="opacity-40 hover:opacity-100">
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
      </div>
      <div className="mt-3 flex items-center gap-2 max-w-[18rem]">
        <Input type="date" value={nuevo} onChange={e => setNuevo(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); add(); } }} />
        <button type="button" onClick={add} className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition-colors whitespace-nowrap">
          <Plus className="h-3.5 w-3.5" /> Agregar
        </button>
      </div>
    </div>
  );
}

function cap(s: string) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

function slugFrecuencia(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/** Editor de frecuencias: built-in fijas (solo activar), personalizadas agregar/editar/eliminar. */
function FrecuenciasEditor({ frecuencias, onChange }: {
  frecuencias: FrecuenciaOpcion[]; onChange: (f: FrecuenciaOpcion[]) => void;
}) {
  const [label, setLabel] = useState("");
  const [dias, setDias] = useState("");

  const toggle = (clave: string) => onChange(frecuencias.map(f => f.clave === clave ? { ...f, activo: !f.activo } : f));
  const remove = (clave: string) => onChange(frecuencias.filter(f => f.clave !== clave));
  const setField = (clave: string, patch: Partial<FrecuenciaOpcion>) =>
    onChange(frecuencias.map(f => f.clave === clave ? { ...f, ...patch } : f));
  const setDiasFrec = (clave: string, d: number) =>
    setField(clave, { dias: d, periodosAnio: Math.round((365 / Math.max(1, d)) * 100) / 100 });

  const add = () => {
    const l = label.trim();
    const d = parseInt(dias);
    if (!l || !d || d < 1) return;
    let clave = slugFrecuencia(l) || `freq_${frecuencias.length}`;
    if (frecuencias.some(f => f.clave === clave)) clave = `${clave}_${frecuencias.length}`;
    onChange([...frecuencias, {
      clave, label: l.toLowerCase(), dias: d,
      periodosAnio: Math.round((365 / d) * 100) / 100,
      esMensual: false, activo: true, builtin: false,
    }]);
    setLabel(""); setDias("");
  };

  return (
    <div className="space-y-2">
      {/* Cabecera de columnas */}
      <div className="flex items-center gap-3 px-3 pb-1">
        <p className="min-w-0 flex-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60">Frecuencia</p>
        <div className="flex items-center gap-2 shrink-0">
          <p className="w-20 text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60 text-center">Días</p>
          <p className="w-20 text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60 text-center">Cuotas fijas</p>
        </div>
        <span className="w-4 shrink-0" />
        <span className="w-4 shrink-0" />
      </div>
      {frecuencias.map(f => (
        <div key={f.clave} className={`flex items-center gap-3 rounded-lg border border-border px-3 py-2 transition-colors ${f.activo ? "bg-primary/[0.06] ring-1 ring-inset ring-primary/25" : "bg-muted/20"}`}>
          <div className="min-w-0 flex-1">
            {f.builtin ? (
              <p className="text-sm font-medium text-foreground">{cap(f.label)}</p>
            ) : (
              <input
                value={f.label}
                onChange={e => setField(f.clave, { label: e.target.value })}
                className="w-full rounded-md border border-border bg-muted/40 px-2 py-1 text-sm text-foreground outline-none focus:border-primary"
              />
            )}
            <p className="mt-0.5 text-[11px] text-muted-foreground/70">
              {f.esMensual ? "mensual (calendario)" : `cada ${f.dias} día${f.dias !== 1 ? "s" : ""}`} · ≈ {f.periodosAnio} pagos/año
            </p>
          </div>
          {!f.esMensual && (
            <div className="flex items-center gap-2 shrink-0">
              {!f.builtin && (
                <div className="w-20">
                  <Input type="number" min="1" step="1" value={f.dias} title="Días por período"
                    onChange={e => setDiasFrec(f.clave, parseInt(e.target.value) || 1)} />
                </div>
              )}
              <div className="w-20">
                <Input
                  type="number" min="1" step="1"
                  placeholder="cuotas"
                  title="N° de cuotas fijas para esta frecuencia"
                  value={f.cuotasFijas ?? ""}
                  onChange={e => {
                    const v = parseInt(e.target.value);
                    setField(f.clave, { cuotasFijas: v > 0 ? v : undefined });
                  }}
                />
              </div>
            </div>
          )}
          <Toggle checked={f.activo} onChange={() => toggle(f.clave)} />
          {!f.builtin ? (
            <button type="button" onClick={() => remove(f.clave)} title="Eliminar frecuencia"
              className="shrink-0 text-muted-foreground/40 hover:text-destructive transition-colors">
              <X className="h-4 w-4" />
            </button>
          ) : (
            <span className="w-4 shrink-0" />
          )}
        </div>
      ))}

      {/* Agregar frecuencia personalizada */}
      <div className="flex items-end gap-2 border-t border-border/60 pt-3">
        <div className="flex-1">
          <Field label="Nueva frecuencia">
            <Input placeholder="Ej: Quincenal" value={label}
              onChange={e => setLabel(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); add(); } }} />
          </Field>
        </div>
        <div className="w-24">
          <Field label="Cada (días)">
            <Input type="number" min="1" step="1" placeholder="15" value={dias}
              onChange={e => setDias(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); add(); } }} />
          </Field>
        </div>
        <button type="button" onClick={add}
          className="inline-flex h-10 items-center gap-1 rounded-lg border border-border px-3 text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition-colors whitespace-nowrap">
          <Plus className="h-3.5 w-3.5" /> Agregar
        </button>
      </div>
    </div>
  );
}

function CargoBlock({ title, desc, activo, onToggle, children, onSave, saving, saved, dirty, ayuda, error }: {
  title: string; desc?: string; activo: boolean; onToggle: (v: boolean) => void; children: React.ReactNode;
  onSave?: () => void; saving?: boolean; saved?: boolean; dirty?: boolean; ayuda?: AyudaBloque;
  /** Motivo por el que el servidor rechazó el último guardado DE ESTE cargo. */
  error?: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-muted/30 p-4 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.03)]">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">{title}</p>
          {desc && <p className="text-xs text-muted-foreground">{desc}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {ayuda && <HelpHint ayuda={ayuda} />}
          <Toggle checked={activo} onChange={onToggle} />
          {onSave && <SaveButton saving={!!saving} saved={!!saved} dirty={dirty} onClick={onSave} />}
        </div>
      </div>
      {/* Mismo criterio que en `Section`: el motivo del rechazo, pegado al cargo que lo causó.
          Estos cuatro bloques mostraban el toast y nada más, así que el "por qué" quedaba
          arriba de una pantalla larga. */}
      {error && (
        <div className="mb-3 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <span className="font-semibold">No se guardó.</span> {error}
        </div>
      )}
      <div className={activo ? "" : "pointer-events-none opacity-40"}>{children}</div>
    </div>
  );
}

/**
 * Switch de encendido/apagado de un ajuste del motor.
 *
 * 🔴 Lleva el estado ESCRITO al lado, no solo la perilla. Un switch pelado obliga a conocer
 * la convención —¿la perilla a la derecha significa prendido?— y acá prender un cargo cambia
 * lo que termina pagando el cliente: adivinar no es una opción. Además, media configuración
 * son ajustes apagados por defecto, así que el estado que hay que poder leer de un vistazo
 * es justamente el que menos se nota.
 *
 * El apagado usa `bg-muted` y no un blanco translúcido: el translúcido se veía bien en
 * oscuro y desaparecía sobre las tarjetas del modo claro.
 */
function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="inline-flex shrink-0 items-center gap-2 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      {/*
        Ancho fijo a propósito: "Activo" e "Inactivo" no miden lo mismo, y sin fijarlo los
        controles que van a la derecha (la X de borrar en la lista de frecuencias) se corren
        de fila en fila según el estado de cada una.
      */}
      <span className={`w-16 text-right text-[11px] font-semibold uppercase tracking-wide transition-colors ${checked ? "text-primary" : "text-muted-foreground"}`}>
        {checked ? "Activo" : "Inactivo"}
      </span>
      <span
        className={`relative inline-flex h-6 w-11 items-center rounded-full px-0.5 transition-colors ${checked ? "bg-primary" : "bg-muted ring-1 ring-inset ring-border"}`}
      >
        <span
          className={`inline-block h-5 w-5 rounded-full shadow-sm transition-transform duration-200 ${checked ? "translate-x-5 bg-white" : "translate-x-0 bg-muted-foreground/60"}`}
        />
      </span>
    </button>
  );
}

function BodySkeleton() {
  return (
    <div className="grid w-full grid-cols-1 gap-5 md:grid-cols-[190px_1fr]">
      <Skeleton className="hidden h-56 rounded-xl md:block" />
      <div className="space-y-4">
        {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-40 rounded-xl" />)}
      </div>
    </div>
  );
}

/**
 * Botón de prueba del canal de email.
 *
 * 🔴 Sin esto, la única forma de saber si el SMTP quedó bien era ir a la ficha de un cliente
 * y escribirle de verdad: si la contraseña estaba mal te enterabas ahí, y si estaba bien ya
 * le habías mandado un mensaje a una persona real para probar. Manda a la casilla del
 * usuario en sesión y usa la config GUARDADA, no la del formulario — prueba lo que va a
 * correr, no lo que hay escrito en pantalla.
 */
function ProbarEmail() {
  const [estado, setEstado] = useState<"idle" | "enviando" | "ok">("idle");
  const [error, setError] = useState<string | null>(null);
  // 🔴 A DÓNDE fue. La prueba se manda a la casilla del USUARIO en sesión, no a la que se
  // configuró como remitente — y sin decirlo, uno revisa la casilla equivocada y concluye
  // que el envío falló.
  const [destino, setDestino] = useState<string | null>(null);
  /** Vacío = la casilla del usuario en sesión. Se puede escribir otra: quien configura el
   *  sistema no siempre tiene acceso al buzón con el que entra. */
  const [para, setPara] = useState("");

  const probar = async () => {
    setEstado("enviando");
    setError(null);
    try {
      const res = await fetch("/api/configuracion/email-prueba", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: para.trim() || undefined }),
      });
      const json = await res.json();
      if (!json.ok) { setError(json.error || "No se pudo enviar"); setEstado("idle"); return; }
      setDestino(json.data?.enviado_a ?? null);
      setEstado("ok");
    } catch {
      setError("No se pudo enviar el email de prueba");
      setEstado("idle");
    }
  };

  return (
    <div className="rounded-lg border border-border bg-muted/20 px-3 py-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">
          {estado === "ok"
            ? <>Enviado a <span className="font-mono text-foreground">{destino ?? "tu casilla"}</span> — revisá también el spam.</>
            : "Probá el envío antes de escribirle a un cliente."}
        </span>
        <input
          type="email"
          value={para}
          onChange={(e) => setPara(e.target.value)}
          placeholder="Mandarla a… (vacío = tu casilla)"
          className="h-8 min-w-0 flex-1 rounded-lg border border-border bg-input px-2.5 text-xs text-foreground placeholder:text-muted-foreground/40 outline-none focus:border-primary"
        />
        <button
          type="button"
          onClick={probar}
          disabled={estado === "enviando"}
          className="shrink-0 rounded-lg border border-primary/30 bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary/20 disabled:opacity-40"
        >
          {estado === "enviando" ? "Enviando…" : estado === "ok" ? "Enviar otra" : "Enviar prueba"}
        </button>
      </div>
      {/* Guardá primero: la prueba corre contra la config persistida, no contra el formulario. */}
      {estado === "idle" && !error && (
        <p className="mt-1 text-[11px] text-muted-foreground/60">Guardá los cambios antes de probar.</p>
      )}
      {error && <p className="mt-1.5 text-[11px] text-destructive">{error}</p>}
    </div>
  );
}
