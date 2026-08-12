"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Loader2, Percent, Plus, X, MessageSquare, Phone, Mail, HelpCircle } from "lucide-react";
import { useConfiguracion, type ConfiguracionFinanciera, type GamificacionConfig, type RentabilidadConfig, type RiesgoConfig, type CobranzaConfig, type NotificacionesConfig } from "@/lib/swr";
import { FeatureGate } from "@/components/providers/FeaturesProvider";
import { FinancieraForm } from "@/components/configuracion/FinancieraForm";
import { BackupsView } from "@/components/configuracion/BackupsView";
import type { SimuladorConfig, CargosConfig, FrecuenciaOpcion, DocumentosConfig } from "@/lib/domain";
import { DOCUMENTOS_DEFAULT, revisarDocumentos, ORDEN_IMPUTACION } from "@/lib/domain";
import { PageHeader } from "@/components/ui/PageHeader";
import { Emoji } from "@/components/ui/Emoji";
import { Field, Input, Select, Textarea, SecretInput } from "@/components/ui/field";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { formatFecha } from "@/lib/utils";

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

const AYUDA: Record<string, AyudaBloque> = {
  motor: {
    titulo: "Motor financiero",
    texto: "Define cómo el sistema interpreta la tasa que cargás en cada crédito y con qué método arma las cuotas.",
    puntos: [
      "Convención de tasa: si el número que escribís es anual (TNA/TEA) o mensual.",
      "Sistema de amortización: hoy Francés (cuota fija todos los períodos).",
    ],
  },
  mora: {
    titulo: "Interés por mora",
    texto: "Recargo que se suma cuando el cliente paga una cuota tarde. Con el switch apagado, no se cobra mora.",
    puntos: [
      "Tasa diaria: % que se acumula por cada día de atraso.",
      "Se aplica sobre el VALOR DE LA CUOTA vencida: cada cuota atrasada devenga su propio punitorio.",
      "Los días de gracia (Simulador → Cronograma) son la tolerancia antes de que empiece a correr.",
    ],
  },
  cobranza: {
    titulo: "Cobranza y control de pagos",
    texto: "Dos controles operativos de la cobranza diaria.",
    puntos: [
      "Días sin gestión: cada cuántos días un moroso sin contactar vuelve a aparecer en la agenda del día.",
      "Días para anular un pago: ventana para revertir un cobro cargado por error (control de tesorería).",
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
      "Quita máx. del vendedor: cuánto puede perdonar por su cuenta. En 0 no condona nada y toda quita la firma un admin, que no tiene tope.",
      "La condonación sale de los punitorios y el interés, NUNCA del capital: la plata que se prestó de verdad no se regala.",
      "El acuerdo no toca el crédito: el cliente paga como siempre y el acuerdo se va cumpliendo solo con esos pagos.",
      "No hay botón para darlo por cumplido: se cumple cuando la plata entra, y eso lo detecta el sistema solo.",
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
    titulo: "Plazos disponibles",
    texto: "Qué cantidades de cuotas puede elegir el operador en el simulador. Tocá un plazo para activarlo o desactivarlo, y agregá los tuyos.",
    puntos: [
      "Plazo por defecto: el que viene preseleccionado al simular. Si lo desactivás, el simulador arranca vacío.",
      "Una frecuencia con cuotas fijas ignora esta lista: usa su propio número y el campo queda bloqueado.",
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
      "Ninguno: la cuota exacta que calcula el motor.",
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
      "Día de vencimiento y día de corte: solo para créditos MENSUALES.",
      "Día de vencimiento: día fijo del mes en que vence cada cuota. Vacío = un período después del desembolso.",
      "Día de corte: después de esa fecha, la 1ª cuota pasa al mes siguiente. Necesita un día de vencimiento.",
      "Sábado no hábil y feriados: corren el vencimiento al próximo día hábil, en TODAS las frecuencias. El domingo nunca es hábil.",
      "En frecuencia diaria eso deja el cronograma en días hábiles, sin amontonar dos cuotas el mismo día.",
      "Días de gracia: tolerancia antes de contar mora.",
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
  const [activeTab, setActiveTab] = useState<"financiera" | "motor" | "simulador" | "comunicaciones" | "gamificacion" | "rentabilidad" | "riesgo" | "documentos" | "notificaciones" | "backups">("financiera");

  // Hidratar el form local cuando llega la config.
  useEffect(() => {
    if (config) setForm(config);
  }, [config]);

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

  const setCobranza = (patch: Partial<CobranzaConfig>) => {
    setForm(prev => prev ? { ...prev, cobranzaConfig: { ...defaultCobranza(), ...prev.cobranzaConfig, ...patch } } : prev);
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
  const avisosDocs = revisarDocumentos(docs);

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

  // ¿El bloque `key` tiene cambios sin guardar respecto de la config del server?
  // Alimenta el estado "dirty" del botón Guardar (sólido solo cuando hay algo que guardar).
  const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  const isDirty = (key: string): boolean => {
    if (!config || !form) return false;
    const f = form, c = config, s = form.simulador, cs = config.simulador;
    switch (key) {
      case "motor":         return f.convencionTasa !== c.convencionTasa || f.sistemaAmortizacion !== c.sistemaAmortizacion;
      case "mora":          return f.moraActiva !== c.moraActiva || f.tasaMoraDiaria !== c.tasaMoraDiaria;
      case "cobranza":      return !eq(f.cobranzaConfig ?? null, c.cobranzaConfig ?? null);
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
      case "cronograma":    return !eq([s.diaCorte, s.diaVencimientoFijo, s.diasGracia, s.incluirSabadoNoHabil, s.feriados], [cs.diaCorte, cs.diaVencimientoFijo, cs.diasGracia, cs.incluirSabadoNoHabil, cs.feriados]);
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
            </nav>

            {/* ─ Contenido de la sección activa ─ */}
            <div className="min-w-0 space-y-4">

          {/* ─── Datos de la financiera (identidad del tenant) ─── */}
          {activeTab === "financiera" && <FinancieraForm />}

          {/* ─── Motor tab: Motor financiero (primero) ─── */}
          {activeTab === "motor" && (
          <Section title="Motor financiero" desc="Cómo se interpreta la tasa y el sistema de cálculo." ayuda={AYUDA.motor}
            onSave={() => save("motor", { convencionTasa: form.convencionTasa, sistemaAmortizacion: form.sistemaAmortizacion })}
            saving={savingKey === "motor"} saved={savedKey === "motor"} dirty={isDirty("motor")}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Convención de tasa" hint="Cómo se interpreta el campo «tasa» de cada crédito">
                <Select value={form.convencionTasa} onChange={e => set("convencionTasa", e.target.value as ConfiguracionFinanciera["convencionTasa"])}>
                  <option value="nominal_anual">Nominal anual (TNA)</option>
                  <option value="efectiva_anual">Efectiva anual (TEA)</option>
                  <option value="mensual">Mensual</option>
                </Select>
              </Field>
              <Field label="Sistema de amortización">
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
                    <Input type="number" min="0" step="any" value={form.simulador.montoDefault}
                      onChange={e => setSim("montoDefault", parseFloat(e.target.value) || 0)} />
                  </Field>
                  <Field label={`Tasa (% ${CONV_CORTA[form.convencionTasa]})`} hint={<EstadoParam on={form.simulador.tasaBase > 0} siOn="Se carga sola en el simulador" siOff="El simulador arranca vacío" />}>
                    <div className="relative">
                      <Input type="number" min="0" step="0.5" value={form.simulador.tasaBase}
                        onChange={e => setSim("tasaBase", parseFloat(e.target.value) || 0)} className="pr-7" />
                      <Percent className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
                    </div>
                  </Field>
                </div>
              </SubGrupo>

              <SubGrupo titulo="Límites de lo que se puede otorgar" nota="En 0 el límite no se aplica">
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                  <Field label="Monto mínimo ($)" hint={<EstadoParam on={form.simulador.montoMin > 0} siOn="No se otorga menos" siOff="Sin mínimo" />}>
                    <Input type="number" min="0" step="any" value={form.simulador.montoMin}
                      onChange={e => setSim("montoMin", parseFloat(e.target.value) || 0)} />
                  </Field>
                  <Field label="Monto máximo ($)" hint={<EstadoParam on={form.simulador.montoMax > 0} siOn="No se otorga más" siOff="Sin tope" />}>
                    <Input type="number" min="0" step="any" value={form.simulador.montoMax}
                      onChange={e => setSim("montoMax", parseFloat(e.target.value) || 0)} />
                  </Field>
                  <Field label="Tasa mínima (%)" hint={<EstadoParam on={form.simulador.tasaMin > 0} siOn="No se otorga por debajo" siOff="Sin mínimo" />}>
                    <div className="relative">
                      <Input type="number" min="0" step="0.5" value={form.simulador.tasaMin}
                        onChange={e => setSim("tasaMin", parseFloat(e.target.value) || 0)} className="pr-7" />
                      <Percent className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
                    </div>
                  </Field>
                  <Field label="Tasa máxima (%)" hint={<EstadoParam on={form.simulador.tasaMax > 0} siOn="No se otorga por encima" siOff="Sin tope" />}>
                    <div className="relative">
                      <Input type="number" min="0" step="0.5" value={form.simulador.tasaMax}
                        onChange={e => setSim("tasaMax", parseFloat(e.target.value) || 0)} className="pr-7" />
                      <Percent className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
                    </div>
                  </Field>
                </div>
              </SubGrupo>

            </div>
          </Section>

          {/* Simulador · Plazos */}
          <Section title="Plazos disponibles" desc="Cuotas que se ofrecen en el simulador. Tocá un plazo para activarlo o desactivarlo." ayuda={AYUDA.plazos}
            onSave={() => saveSim("plazos")} saving={savingKey === "plazos"} saved={savedKey === "plazos"} dirty={isDirty("plazos")} error={errorKey === "plazos" ? saveError ?? undefined : undefined}>
            <PlazosEditor plazos={form.simulador.plazos} onChange={p => setSim("plazos", p)} />
            <div className="mt-4 max-w-xs">
              <Field label="Plazo por defecto" hint="Preseleccionado en el simulador">
                <Select value={String(form.simulador.plazoDefault)} onChange={e => setSim("plazoDefault", parseInt(e.target.value))}>
                  {form.simulador.plazos.filter(p => p.activo).map(p => (
                    <option key={p.cuotas} value={p.cuotas}>{p.cuotas} cuotas</option>
                  ))}
                  {form.simulador.plazos.filter(p => p.activo).length === 0 && <option value="">— sin plazos activos —</option>}
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
              <Field label="Frecuencia por defecto" hint="Preseleccionada en el simulador">
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
          <Section title="Redondeo de cuota" desc="Deja la cuota del cliente en un número redondo. La última absorbe la diferencia." ayuda={AYUDA.redondeo}
            onSave={() => saveSim("redondeo")} saving={savingKey === "redondeo"} saved={savedKey === "redondeo"} dirty={isDirty("redondeo")}
            error={errorKey === "redondeo" ? saveError ?? undefined : undefined}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Redondeo de cuota">
                <Select value={form.simulador.redondeoCuota.modo}
                  onChange={e => setSim("redondeoCuota", { ...form.simulador.redondeoCuota, modo: e.target.value as SimuladorConfig["redondeoCuota"]["modo"] })}>
                  <option value="ninguno">Ninguno (exacta)</option>
                  <option value="entero">Al entero</option>
                  <option value="multiplo">A múltiplo</option>
                </Select>
              </Field>
              <Field label="Múltiplo" hint="Solo si redondea a múltiplo">
                <Input type="number" min="1" step="1" value={form.simulador.redondeoCuota.multiplo}
                  disabled={form.simulador.redondeoCuota.modo !== "multiplo"}
                  onChange={e => setSim("redondeoCuota", { ...form.simulador.redondeoCuota, multiplo: parseInt(e.target.value) || 1 })} />
              </Field>
            </div>
          </Section>

          {/* Simulador · Cronograma de cobranza */}
          <Section title="Cronograma de cobranza" desc="Cuándo vence cada cuota y cuándo empieza a correr la mora. Se congela al otorgar." ayuda={AYUDA.cronograma}
            onSave={() => saveSim("cronograma")} saving={savingKey === "cronograma"} saved={savedKey === "cronograma"} dirty={isDirty("cronograma")}
            error={errorKey === "cronograma" ? saveError ?? undefined : undefined}>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <Field label="Día de corte" hint="1–28. Vacío = sin corte (1ª cuota al mes siguiente)">
                <Input type="number" min="1" max="28" step="1"
                  value={form.simulador.diaCorte ?? ""}
                  onChange={e => setSim("diaCorte", e.target.value === "" ? null : Math.min(28, Math.max(1, parseInt(e.target.value) || 1)))} />
              </Field>
              <Field label="Día de vencimiento" hint="1–28. Vacío = un período desde el desembolso">
                <Input type="number" min="1" max="28" step="1"
                  value={form.simulador.diaVencimientoFijo ?? ""}
                  onChange={e => setSim("diaVencimientoFijo", e.target.value === "" ? null : Math.min(28, Math.max(1, parseInt(e.target.value) || 1)))} />
              </Field>
              <Field label="Días de gracia" hint="Tolerancia tras el vencimiento antes de la mora">
                <Input type="number" min="0" step="1" value={form.simulador.diasGracia}
                  onChange={e => setSim("diasGracia", Math.max(0, parseInt(e.target.value) || 0))} />
              </Field>
            </div>

            <div className="mt-4">
              <SwitchRow
                title="Sábado no hábil"
                desc="Si está activo, los vencimientos que caen sábado también se corren al lunes."
                checked={form.simulador.incluirSabadoNoHabil}
                onChange={v => setSim("incluirSabadoNoHabil", v)}
              />
            </div>

            <div className="mt-4">
              <FeriadosEditor feriados={form.simulador.feriados} onChange={f => setSim("feriados", f)} />
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
                  : <> (el primero, al mes siguiente del desembolso)</>}
                . Si esa fecha cae domingo{form.simulador.incluirSabadoNoHabil ? ", sábado" : ""} o feriado, se corre al día hábil siguiente.
              </p>
            ) : null}
          </Section>

          {/* Simulador · Cargos */}
          <Section title="Cargos del crédito" desc="Comisiones e impuestos que se suman a la cuota o al costo total. Todo desactivado = cuota pura." ayuda={AYUDA.cargos}>
            <div className="space-y-3">
              {/* Comisión de otorgamiento */}
              <CargoBlock title="Comisión de otorgamiento" desc="Cargo único por dar el crédito." ayuda={AYUDA["cargo-comision"]}
                activo={form.simulador.cargos.comisionOtorgamiento.activo}
                onToggle={v => setCargo("comisionOtorgamiento", "activo", v)}
                onSave={() => saveSim("cargo-comision")} saving={savingKey === "cargo-comision"} saved={savedKey === "cargo-comision"} dirty={isDirty("cargo-comision")}>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <Field label="Modo">
                    <Select value={form.simulador.cargos.comisionOtorgamiento.modo}
                      onChange={e => setCargo("comisionOtorgamiento", "modo", e.target.value as CargosConfig["comisionOtorgamiento"]["modo"])}>
                      <option value="porcentaje">% del monto</option>
                      <option value="fijo">Monto fijo</option>
                    </Select>
                  </Field>
                  <Field label="Valor">
                    <Input type="number" min="0" step="0.5" value={form.simulador.cargos.comisionOtorgamiento.valor}
                      onChange={e => setCargo("comisionOtorgamiento", "valor", parseFloat(e.target.value) || 0)} />
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
                onSave={() => saveSim("cargo-iva")} saving={savingKey === "cargo-iva"} saved={savedKey === "cargo-iva"} dirty={isDirty("cargo-iva")}>
                <div className="max-w-[12rem]">
                  <Field label="Tasa de IVA (%)">
                    <Input type="number" min="0" step="0.5" value={Number((form.simulador.cargos.iva.tasa * 100).toFixed(2))}
                      onChange={e => setCargo("iva", "tasa", (parseFloat(e.target.value) || 0) / 100)} />
                  </Field>
                </div>
              </CargoBlock>

              {/* Seguro */}
              <CargoBlock title="Seguro" desc="Cobertura aplicada por período." ayuda={AYUDA["cargo-seguro"]}
                activo={form.simulador.cargos.seguro.activo}
                onToggle={v => setCargo("seguro", "activo", v)}
                onSave={() => saveSim("cargo-seguro")} saving={savingKey === "cargo-seguro"} saved={savedKey === "cargo-seguro"} dirty={isDirty("cargo-seguro")}>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Field label="Base">
                    <Select value={form.simulador.cargos.seguro.modo}
                      onChange={e => setCargo("seguro", "modo", e.target.value as CargosConfig["seguro"]["modo"])}>
                      <option value="porcentaje_saldo">% del saldo</option>
                      <option value="porcentaje_monto">% del monto original</option>
                      <option value="fijo">Monto fijo por cuota</option>
                    </Select>
                  </Field>
                  <Field label={form.simulador.cargos.seguro.modo === "fijo" ? "Valor ($)" : "Valor (%)"}>
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
                onSave={() => saveSim("cargo-gastos")} saving={savingKey === "cargo-gastos"} saved={savedKey === "cargo-gastos"} dirty={isDirty("cargo-gastos")}>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Field label="Modo">
                    <Select value={form.simulador.cargos.gastosAdministrativos.modo}
                      onChange={e => setCargo("gastosAdministrativos", "modo", e.target.value as CargosConfig["gastosAdministrativos"]["modo"])}>
                      <option value="fijo">Monto fijo por cuota</option>
                      <option value="porcentaje">% de la cuota</option>
                    </Select>
                  </Field>
                  <Field label={form.simulador.cargos.gastosAdministrativos.modo === "fijo" ? "Valor ($)" : "Valor (%)"}>
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

          {/* ─── Motor tab: Mora, Imputación, Presentación ─── */}
          {activeTab === "motor" && <>

          {/* Mora */}
          <Section title="Interés por mora" desc="Recargo aplicado por días de atraso. Apagá el switch para no cobrar mora." ayuda={AYUDA.mora}
            enabled={form.moraActiva} onToggle={v => set("moraActiva", v)}
            onSave={() => save("mora", { moraActiva: form.moraActiva, tasaMoraDiaria: form.tasaMoraDiaria })}
            saving={savingKey === "mora"} saved={savedKey === "mora"} dirty={isDirty("mora")}>
            <div className={`grid grid-cols-1 gap-4 max-w-sm transition-opacity ${form.moraActiva ? "" : "opacity-50"}`}>
              <Field label="Tasa de mora diaria (%)" hint="Porcentaje diario sobre la base de mora">
                <div className="relative">
                  <Input
                    type="number" min="0" step="0.1"
                    value={Number((form.tasaMoraDiaria * 100).toFixed(4))}
                    onChange={e => set("tasaMoraDiaria", (parseFloat(e.target.value) || 0) / 100)}
                    disabled={!form.moraActiva}
                    className="pr-7"
                  />
                  <Percent className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
                </div>
              </Field>

            </div>
          </Section>

          {/* Agenda de cobranza */}
          <Section title="Cobranza y control de pagos" desc="Umbral de la agenda del día y la ventana para anular un pago cargado por error (control de tesorería)." ayuda={AYUDA.cobranza}
            onSave={() => save("cobranza", { cobranzaConfig: cobranza })}
            saving={savingKey === "cobranza"} saved={savedKey === "cobranza"} dirty={isDirty("cobranza")}>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 max-w-xl">
              <Field label="Días sin gestión" hint="Un moroso reaparece en la agenda si nadie lo contactó en esta cantidad de días (1–90).">
                <Input
                  type="number" min="1" max="90" step="1"
                  value={cobranza.dias_sin_gestion}
                  onChange={e => setCobranza({ dias_sin_gestion: Math.max(1, Math.min(90, Math.round(parseFloat(e.target.value) || 1))) })}
                />
              </Field>
              <Field label="Días para anular un pago" hint="Pasado este plazo desde que se registró el pago, ya no se puede anular (0 = solo el mismo día).">
                <Input
                  type="number" min="0" max="365" step="1"
                  value={cobranza.dias_anulacion_pago}
                  onChange={e => setCobranza({ dias_anulacion_pago: Math.max(0, Math.min(365, Math.round(parseFloat(e.target.value) || 0))) })}
                />
              </Field>
            </div>
          </Section>

          {/* Acuerdos de pago */}
          <Section title="Acuerdos de pago" desc="El arreglo informal en cuotas con un moroso: hasta cuántas cuotas, qué lo rompe y quién puede condonar." ayuda={AYUDA.acuerdos}
            onSave={() => save("cobranza", { cobranzaConfig: cobranza })}
            saving={savingKey === "cobranza"} saved={savedKey === "cobranza"} dirty={isDirty("cobranza")}>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 max-w-3xl">
              <Field label="Máximo de cuotas" hint="El techo del vendedor: hasta en cuántos pagos puede repartir lo vencido sin consultar. Con 6 puede ofrecer 6, no 8.">
                <Input
                  type="number" min="1" max="60" step="1"
                  value={cobranza.acuerdos.max_cuotas}
                  onChange={e => setAcuerdos({ max_cuotas: Math.max(1, Math.min(60, Math.round(parseFloat(e.target.value) || 1))) })}
                />
              </Field>
              <Field label="Días entre cuotas" hint="Cada cuánto vence una cuota del acuerdo: 30 = mensual · 15 = quincenal · 7 = semanal. No depende de la frecuencia del crédito.">
                <Input
                  type="number" min="1" max="365" step="1"
                  value={cobranza.acuerdos.dias_entre_cuotas}
                  onChange={e => setAcuerdos({ dias_entre_cuotas: Math.max(1, Math.min(365, Math.round(parseFloat(e.target.value) || 1))) })}
                />
              </Field>
              <Field label="Cuotas impagas que lo rompen" hint="Con 1 se cae al primer faltazo; con 2 o 3 tolerás un tropiezo. Al romperse vuelve a morosos y los punitorios corren de nuevo.">
                <Input
                  type="number" min="1" step="1"
                  value={cobranza.acuerdos.cuotas_para_romper}
                  onChange={e => setAcuerdos({ cuotas_para_romper: Math.max(1, Math.round(parseFloat(e.target.value) || 1)) })}
                />
              </Field>
              <Field label="Quita máx. del vendedor (%)" hint="Cuánto de los punitorios e interés puede perdonar el vendedor por su cuenta. En 0 no condona nada: toda quita la firma un admin, que no tiene tope. El capital nunca se toca.">
                <Input
                  type="number" min="0" max="100" step="1"
                  value={cobranza.acuerdos.quita_max_vendedor_pct}
                  onChange={e => setAcuerdos({ quita_max_vendedor_pct: Math.max(0, Math.min(100, parseFloat(e.target.value) || 0)) })}
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
                      <option value="smtp">SMTP</option>
                      <option value="resend">Resend</option>
                      <option value="sendgrid">SendGrid</option>
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
          >
            <div className="space-y-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field label="Ratio cuota / ingreso máx (%)" hint="La cuota no puede superar este % del ingreso neto del cliente">
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
                <Field label="Máx. créditos activos por cliente" hint="Tope de créditos vigentes simultáneos. 0 = sin límite">
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
                <Field label="Score externo mínimo" hint="0–1000 (Nosis/Veraz). Vacío = no se exige">
                  <Input type="number" min="0" max="1000" step="10"
                    value={riesgo.politica.scoreExternoMin ?? ""}
                    onChange={e => setRiesgo({ scoreExternoMin: e.target.value === "" ? null : Math.max(0, parseInt(e.target.value) || 0) })} />
                </Field>
                <Field label="Si el cliente no califica" hint="Qué hace el sistema cuando no cumple la política">
                  <Select value={riesgo.politica.accionAlNoCalificar}
                    onChange={e => setRiesgo({ accionAlNoCalificar: e.target.value as RiesgoConfig["politica"]["accionAlNoCalificar"] })}>
                    <option value="autorizar">Avisar y dejar autorizar (decisión humana)</option>
                    <option value="bloquear">Bloquear el otorgamiento</option>
                  </Select>
                </Field>
              </div>

              <SwitchRow
                title="Bloquear si tiene cuotas vencidas impagas"
                desc="Impedimento absoluto: no se puede otorgar a un cliente que ya está en mora, ni siquiera con autorización del admin."
                checked={riesgo.politica.bloquearConCuotasVencidas}
                onChange={v => setRiesgo({ bloquearConCuotasVencidas: v })}
              />

              <SwitchRow
                title="Rechazar con cheques rechazados"
                desc="Si el bureau informa cheques rechazados sin regularizar, el cliente no califica."
                checked={riesgo.politica.rechazaConChequesRechazados}
                onChange={v => setRiesgo({ rechazaConChequesRechazados: v })}
              />

              {/* ── Bureau de crédito (integración por API) — PREMIUM (plan Pro) ── */}
              <FeatureGate feature="bureau_credito">
              <div className="border-t border-border pt-4">
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-3">Bureau de crédito (verificación externa · Pro)</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Field label="Proveedor" hint="Fuente de las señales externas (situación BCRA, score, cheques)">
                    <Select value={riesgo.bureau.proveedor}
                      onChange={e => setBureau({ proveedor: e.target.value as RiesgoConfig["bureau"]["proveedor"] })}>
                      <option value="manual">Manual (el analista carga los valores)</option>
                      <option value="bcra">BCRA — Central de Deudores (gratis)</option>
                      <option value="nosis">Nosis (requiere contrato)</option>
                      <option value="veraz">Veraz / Equifax (requiere contrato)</option>
                    </Select>
                  </Field>
                  <Field label="Consulta automática" hint="Consultar el bureau al evaluar (igual se puede consultar a mano)">
                    <div className="flex h-10 items-center">
                      <Toggle checked={riesgo.bureau.enabled} onChange={v => setBureau({ enabled: v })} />
                    </div>
                  </Field>
                </div>

                {(riesgo.bureau.proveedor === "nosis" || riesgo.bureau.proveedor === "veraz") && (
                  <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <Field label="Endpoint (URL base)">
                      <Input placeholder="https://api.proveedor.com" value={riesgo.bureau.endpoint}
                        onChange={e => setBureau({ endpoint: e.target.value })} />
                    </Field>
                    <Field label="Usuario (si aplica)">
                      <Input placeholder="usuario" value={riesgo.bureau.usuario}
                        onChange={e => setBureau({ usuario: e.target.value })} />
                    </Field>
                    <Field label="Token / API key" hint="Secreto: se guarda enmascarado">
                      <SecretInput placeholder="••••••••" value={riesgo.bureau.token}
                        onChange={e => setBureau({ token: e.target.value })} />
                    </Field>
                  </div>
                )}

                <p className="mt-3 rounded-lg bg-muted/20 border border-border/60 px-3 py-2 text-[11px] text-muted-foreground/80">
                  {riesgo.bureau.proveedor === "bcra"
                    ? "BCRA es una API pública y gratuita: no requiere credenciales. Consultá el perfil desde la ficha del cliente."
                    : riesgo.bureau.proveedor === "manual"
                    ? "Modo manual: el analista carga la situación/score en la ficha del cliente; el motor los usa igual."
                    : "Nosis/Veraz requieren contrato del cliente. Al cargar las credenciales, se completa el provider en lib/bureau/ para consultas reales."}
                </p>
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
          {activeTab === "documentos" && (
          <Section
            title="Documentos del crédito"
            desc="Lo que se imprime en la solicitud de préstamo y en el pagaré. Se define una vez; los datos de cada operación los completa el sistema."
            ayuda={AYUDA.documentos}
            onSave={() => save("documentos", { documentosConfig: docs } as Partial<ConfiguracionFinanciera>)}
            saving={savingKey === "documentos"} saved={savedKey === "documentos"} dirty={isDirty("documentos")}
          >
            <div className="space-y-4">
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
                <Field label="Interés punitorio mensual (%)" hint="Recargo por pagar fuera de término">
                  <Input
                    type="number" min="0" max="100" step="any"
                    value={String(docs.punitorio_mensual)}
                    onChange={e => setDocs({ punitorio_mensual: parseFloat(e.target.value) || 0 })}
                    className="font-mono tabular-nums"
                  />
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
    dias_anulacion_pago: 3,
    acuerdos: {
      max_cuotas: 6, dias_entre_cuotas: 30, cuotas_para_romper: 1,
      congela_punitorios: true, saca_de_agenda: true,
      quita_max_vendedor_pct: 0,
    },
  };
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
      maxCreditosActivos: 0,
      maxEdicionesSueldoVendedor: 3,
      alertaSaltoSueldoPct: 50,
      bloquearConCuotasVencidas: true,
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
        <div className="absolute right-0 top-9 z-30 w-80 max-w-[calc(100vw-2rem)] rounded-xl border border-border bg-card p-3.5 text-left shadow-2xl shadow-black/30">
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

function PlazosEditor({ plazos, onChange }: { plazos: SimuladorConfig["plazos"]; onChange: (p: SimuladorConfig["plazos"]) => void }) {
  const [nuevo, setNuevo] = useState("");
  const add = () => {
    const n = parseInt(nuevo);
    if (!n || n < 1 || plazos.some(p => p.cuotas === n)) { setNuevo(""); return; }
    onChange([...plazos, { cuotas: n, activo: true }].sort((a, b) => a.cuotas - b.cuotas));
    setNuevo("");
  };
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        {plazos.length === 0 && <span className="text-xs text-muted-foreground/60">Sin plazos definidos.</span>}
        {plazos.map(p => (
          <span
            key={p.cuotas}
            className={`group inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-sm transition-colors ${p.activo ? "border-primary bg-primary/10 text-primary" : "border-border bg-muted/30 text-muted-foreground"}`}
          >
            <button type="button" onClick={() => onChange(plazos.map(x => x.cuotas === p.cuotas ? { ...x, activo: !x.activo } : x))} title={p.activo ? "Desactivar" : "Activar"}>
              {p.cuotas} cuotas
            </button>
            <button type="button" onClick={() => onChange(plazos.filter(x => x.cuotas !== p.cuotas))} title="Quitar" className="opacity-40 hover:opacity-100">
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
      </div>
      <div className="mt-3 flex items-center gap-2 max-w-[14rem]">
        <Input type="number" min="1" step="1" placeholder="N° de cuotas" value={nuevo}
          onChange={e => setNuevo(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); add(); } }} />
        <button type="button" onClick={add} className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition-colors whitespace-nowrap">
          <Plus className="h-3.5 w-3.5" /> Agregar
        </button>
      </div>
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

function CargoBlock({ title, desc, activo, onToggle, children, onSave, saving, saved, dirty, ayuda }: {
  title: string; desc?: string; activo: boolean; onToggle: (v: boolean) => void; children: React.ReactNode;
  onSave?: () => void; saving?: boolean; saved?: boolean; dirty?: boolean; ayuda?: AyudaBloque;
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
