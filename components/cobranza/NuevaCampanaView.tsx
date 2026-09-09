"use client";

import { Fragment, useEffect, useMemo, useState, type ComponentType } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { mutate as globalMutate } from "swr";
import { ArrowLeft, Mail, Smartphone, Sparkles, Check, Loader2, Users } from "lucide-react";
import { WhatsAppIcon } from "@/components/ui/WhatsAppIcon";
import { useCreditos, useConfiguracion, useFinanciera, useOfertaRecupero, KEYS, type Credito } from "@/lib/swr";
import {
  calculateRecoveryOffer,
  construirMensajeCampana,
  linkWhatsapp,
  TEMPLATE_DEFAULT,
  TEMPLATE_VENCIMIENTO_DEFAULT,
  plantillaMetaParaCampana,
  riesgoEnvioMeta,
  CATEGORIA_META_LABEL,
  contactoBloqueado,
  TEMPLATE_REFINANCIACION_DEFAULT,
  TEMPLATE_MORA_SIN_PROMO,
  TEMPLATE_RECUPERO_DEFAULT,
  sugerirOfertaCancelacion,
  type CanalCampana,
} from "@/lib/domain";
import { AvisoMeta } from "@/components/clientes/ContactarDialog";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { SystemControls } from "@/components/ui/SystemControls";
import { Emoji } from "@/components/ui/Emoji";
import { Skeleton } from "@/components/ui/skeleton";
import { nombreCompleto, formatMonto, formatDias , formatFecha, hoyComercial } from "@/lib/utils";
import { useConfirm } from "@/components/ui/confirm";
import { useToast } from "@/components/ui/toast";
import { type Role } from "@/lib/auth/roles";
import { leerSeleccionCampana, limpiarSeleccionCampana, guardarSeleccionCampana, leerTipoCampana, limpiarTipoCampana, type TipoCampana } from "./seleccion-campana";

const CANAL_META: Record<CanalCampana, { label: string; icon: ComponentType<{ className?: string }> }> = {
  whatsapp: { label: "WhatsApp", icon: WhatsAppIcon },
  email: { label: "Email", icon: Mail },
  sms: { label: "SMS", icon: Smartphone },
};

/**
 * Nueva campaña de recuperación — PANTALLA COMPLETA (ruta `/cobranza/campanas/nueva`).
 *
 * 🔴 Era un modal y dejó de serlo a propósito.
 * Es una de las herramientas más usadas de la cobranza y decide un reclamo que sale por
 * escrito a decenas de clientes a la vez. En una caja de 576px de ancho, la configuración y
 * la lista de destinatarios se peleaban el mismo scroll: para releer a quién le va a llegar
 * había que perder de vista el mensaje que estaba escribiendo, y los importes entraban como
 * texto corrido —"$1.313.140,27 de cuotas + $885.056,56 de punitorios"— donde nadie podía
 * comparar una fila con otra.
 *
 * Full-bleed, igual que el simulador de crédito: los parámetros a la izquierda, la audiencia
 * a la derecha como tabla con columnas, y el total de lo que se ofrece siempre a la vista en
 * la barra de abajo.
 */
export function NuevaCampanaView({ role }: { role: Role }) {
  const router = useRouter();
  const { creditos: todos, isLoading } = useCreditos();

  /** Ids traídos de la lista de Cobranzas. `null` = todavía no se leyó el storage. */
  const [ids, setIds] = useState<string[] | null>(null);
  useEffect(() => setIds(leerSeleccionCampana()), []);

  const volver = (tab?: string) => router.push(tab ? `/cobranza?tab=${tab}` : "/cobranza");

  /**
   * Los créditos se rehidratan contra `/api/creditos`, no se arrastran desde la lista: de ahí
   * salen `vencido` y `cuotas_vencidas`, que son la base de la oferta, y ahí el backend aplica
   * el scope del vendedor.
   */
  const { seleccionados, bloqueados } = useMemo(() => {
    if (!ids) return { seleccionados: [] as Credito[], bloqueados: 0 };
    const set = new Set(ids);
    const enSeleccion = todos.filter((c) => set.has(c.id));
    // A un fallecido o a un "no contactar" no se le manda una campaña: el backend ya los
    // descarta al armarla, así que mostrarlos acá prometería un número que después no se
    // cumple. Se los cuenta aparte para que el operador vea por qué son menos de los que tildó.
    const contactables = enSeleccion.filter((c) => !contactoBloqueado(c.cliente).bloqueado);
    return { seleccionados: contactables, bloqueados: enSeleccion.length - contactables.length };
  }, [ids, todos]);

  const cargando = ids === null || isLoading;

  return (
    <div className="-mx-4 -mb-6 md:-mx-6 md:-mb-8 lg:-mx-8 flex h-[calc(100dvh-3rem)] flex-col bg-background">
      {/* Header de la sección — misma altura (76px) que el PageHeader y el branding del sidebar */}
      <div className="flex h-[76px] shrink-0 items-center justify-between gap-3 border-b border-edge px-5">
        <div className="flex min-w-0 items-center gap-3">
          <button
            onClick={() => volver()}
            title="Volver a cobranzas"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-border/60 bg-muted/40">
            <Emoji name="megaphone" className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-base font-semibold leading-tight text-foreground">Nueva campaña de recuperación</h1>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              Reclamo masivo a los créditos seleccionados
            </p>
          </div>
        </div>
        <SystemControls />
      </div>

      <div className="min-h-0 flex-1">
        {cargando ? (
          <div className="space-y-3 p-6">
            <Skeleton className="h-8 w-64" />
            <Skeleton className="h-64 w-full" />
          </div>
        ) : seleccionados.length === 0 ? (
          <SinAudiencia bloqueados={bloqueados} onVolver={() => volver()} />
        ) : (
          <CampanaWorkspace
            role={role}
            creditos={seleccionados}
            bloqueados={bloqueados}
            onCancelar={() => volver()}
            onTerminar={(restantes) => {
              /**
               * Si quedó la OTRA audiencia sin su campaña, la selección se conserva.
               *
               * Son los mismos clientes que se acaban de tildar: obligarlo a volver a
               * Cobranzas y buscarlos de a uno es la forma más segura de que la segunda
               * campaña —la de refinanciación, casi siempre— no se mande nunca.
               */
              if (restantes && restantes.length > 0) guardarSeleccionCampana(restantes);
              else limpiarSeleccionCampana();
              globalMutate(KEYS.campanas);
              volver("campanas");
            }}
          />
        )}
      </div>
    </div>
  );
}

/**
 * La selección se perdió (pestaña nueva, storage bloqueado) o quedó vacía porque todos los
 * tildados eran no contactables. Se dice cuál de las dos cosas pasó: una se arregla volviendo
 * a elegir, la otra no se arregla nunca.
 */
function SinAudiencia({ bloqueados, onVolver }: { bloqueados: number; onVolver: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
      <Emoji name="megaphone" className="h-10 w-10 opacity-60" />
      <p className="text-sm font-medium text-foreground">
        {bloqueados > 0 ? "No queda nadie a quien contactar" : "No hay créditos seleccionados"}
      </p>
      <p className="max-w-md text-xs text-muted-foreground">
        {bloqueados > 0
          ? `Los ${bloqueados} créditos elegidos son de clientes marcados como fallecidos o "no contactar".`
          : "Elegí en la lista de morosos a quiénes va dirigida la campaña y volvé a entrar."}
      </p>
      <button
        onClick={onVolver}
        className="mt-1 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
      >
        Volver a cobranzas
      </button>
    </div>
  );
}

interface WorkspaceProps {
  role: Role;
  creditos: Credito[];
  bloqueados: number;
  onCancelar: () => void;
  /** `restantes` = ids de la audiencia que quedó sin campaña, para no perder la selección. */
  onTerminar: (restantes?: string[]) => void;
}

function CampanaWorkspace({ role, creditos: todosCreditos, bloqueados, onCancelar, onTerminar }: WorkspaceProps) {
  const reducirMovimiento = useReducedMotion();
  const { config } = useConfiguracion();
  const { financiera } = useFinanciera();
  const confirm = useConfirm();
  const toast = useToast();
  const whatsappApiActiva = !!config?.whatsappConfig?.enabled;

  /**
   * Las plantillas aprobadas por Meta, ya traducidas al vocabulario de las campañas.
   *
   * Una plantilla que use un dato que la campaña no sabe completar —el número de cuota, la
   * fecha de vencimiento— queda deshabilitada con el motivo a la vista. Ofrecerla igual
   * mandaría por escrito a todo el lote una variable sin resolver.
   */
  const plantillasMeta = useMemo(() => {
    const marca = financiera?.nombre?.trim() || "tu financiera";
    return (config?.cobranzaConfig?.plantillas_meta ?? [])
      /**
       * 🔴 SOLO LAS DE MORA. Esta campaña se arma sobre créditos en mora: es un reclamo,
       * lleve o no un descuento de interés como incentivo. Ofrecer acá una plantilla de
       * promoción o de información le mandaría a todo el lote un texto que no habla de su
       * deuda.
       */
      .filter((p) => p.activa && p.motivo === "mora")
      .map((p) => ({ ...p, ...plantillaMetaParaCampana(p, marca) }));
  }, [config, financiera]);

  /**
   * Los cuatro textos de fábrica. Sirve para saber si el operador escribió el suyo: si el
   * mensaje sigue siendo uno de estos, cambiar de audiencia o apagar el descuento lo
   * reemplaza; si lo redactó a mano, no se le toca.
   */
  const TEMPLATES_DEFAULT = [
    TEMPLATE_DEFAULT, TEMPLATE_MORA_SIN_PROMO, TEMPLATE_VENCIMIENTO_DEFAULT, TEMPLATE_REFINANCIACION_DEFAULT,
    TEMPLATE_RECUPERO_DEFAULT,
  ];

  /** Hoy en el día comercial argentino (YYYY-MM-DD), para el default y el mínimo del calendario. */
  const HOY_ISO = hoyComercial().toISOString().slice(0, 10);

  const [form, setForm] = useState({
    nombre: "",
    descripcion: "",
    canal: "whatsapp" as CanalCampana,
    promoActiva: true,
    promo_valor: "50",
    /**
     * 🔴 ARRANCA HOY, Y NO SE PUEDE DEJAR VACÍO.
     *
     * Era opcional y venía en blanco. Sin fecha, el descuento no vence nunca: se le vuelve a
     * aplicar a esos créditos cada vez que paguen, hasta que alguien finalice la campaña a
     * mano. Un incentivo de recupero vale porque vence — "pagá hoy y te perdono los
     * punitorios" —; sin plazo no apura a nadie y se regalan punitorios por olvido.
     *
     * El default es el MISMO DÍA, que es el caso normal de una campaña de cobranza; correrlo
     * a una semana es un clic en el calendario.
     */
    promo_vence: HOY_ISO,
    // El texto por defecto depende de a quién se le habla: al que está al día no se le
    // dice que regularice su situación.
    mensaje_template: leerTipoCampana() === "vencimiento"
      ? TEMPLATE_VENCIMIENTO_DEFAULT
      : leerTipoCampana() === "recupero"
        ? TEMPLATE_RECUPERO_DEFAULT
        : TEMPLATE_DEFAULT,
    /** Nombre de la plantilla de Meta elegida ("" = texto libre). */
    plantilla_meta: "",
    /** Recupero: fijar un mismo % para todos en vez de la sugerencia por caso. */
    recuperoPctFijo: false,
    recupero_pct: "50",
  });
  const [loading, setLoading] = useState(false);
  const [enviandoApi, setEnviandoApi] = useState(false);
  /** Avance del envío por tandas: cuántos salieron y cuántos faltan. */
  const [progreso, setProgreso] = useState<{ enviados: number; pendientes: number; procesados: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [launched, setLaunched] = useState(false);
  const [campanaId, setCampanaId] = useState<string | null>(null);
  const [enviados, setEnviados] = useState<Set<string>>(new Set());
  /**
   * Crédito cuya fila está enfocada en la tabla: es el que se usa para mostrar el mensaje ya
   * resuelto. `null` = todavía no eligió ninguna y manda el primero de la lista.
   *
   * El mensaje lleva el importe de CADA cliente adentro, así que una sola vista previa fija
   * solo prueba el texto del primero: no muestra qué le va a llegar a un moroso de 5 cuotas
   * ni a uno con el descuento en cero.
   */
  const [foco, setFoco] = useState<string | null>(null);

  /*
    QUÉ RECLAMA esta campaña. Arranca en lo que dijo la pestaña que la armó (Morosos o
    Vencimientos) y puede cambiar acá: los morosos cuyo plan ya venció no van en una campaña
    de reclamo sino en una de refinanciación (ver el corte de audiencias más abajo).
  */
  const [tipoCampana, setTipoCampana] = useState<TipoCampana>(() => leerTipoCampana());
  const esRecordatorio = tipoCampana === "vencimiento";
  const esRefinanciacion = tipoCampana === "refinanciacion";
  /** Oferta de cancelación sobre deuda ya dada por perdida (pestaña Incobrables). */
  const esRecupero = tipoCampana === "recupero";
  /** Con qué criterio sugerir la cancelación. Lo fija la financiera en Configuración. */
  const cfgOferta = useOfertaRecupero();

  /**
   * En una campaña de refinanciación no hay descuento posible: la quita de la campaña se
   * aplica AL COBRAR, y a estos créditos no se les cobra. El descuento de una refinanciación
   * se pacta en su pantalla, cliente por cliente y con su tope.
   */
  const descuentoPct = form.promoActiva && tipoCampana !== "refinanciacion" && tipoCampana !== "recupero"
    ? Math.min(100, Math.max(0, parseFloat(form.promo_valor) || 0))
    : 0;
  /**
   * En un RECUPERO el número no es un descuento sobre punitorios: es qué porcentaje del
   * CAPITAL EN RIESGO se le pide a cada uno. Vacío o 0 = lo que sugiere el motor para cada
   * caso, que es lo normal; un valor fijo es la "liquidación de cartera vieja", pareja para
   * todos.
   */
  const pctRecuperoFijo = esRecupero && form.recuperoPctFijo
    ? Math.min(100, Math.max(0, parseFloat(form.recupero_pct) || 0))
    : 0;

  /**
   * 🔴 Tope de descuento del vendedor (Configuración → Cobranza → Acuerdos).
   *
   * Es el MISMO límite que ya regía en los acuerdos de pago y en la refinanciación, y que la
   * campaña se salteaba: un vendedor que no podía perdonar un peso en un acuerdo armaba una
   * campaña al 100% y le condonaba los punitorios a todo el lote de una vez. El admin no
   * tiene tope —un límite que él mismo edita en Configuración no es un límite—.
   *
   * Acá solo se MUESTRA: quien rechaza es `POST /api/cobranza/campanas`.
   */
  const topeDescuento = role === "admin" ? 100 : (config?.cobranzaConfig?.acuerdos?.quita_max_vendedor_pct ?? 0);
  /**
   * Mientras la configuración no llegó, el tope todavía no se sabe y no se marca nada: con el
   * 50% precargado, dar por hecho un tope de 0 pintaba el campo de rojo apenas se abría la
   * pantalla y se corregía solo un instante después.
   */
  const topeConocido = role === "admin" || !!config?.cobranzaConfig;
  const excedeTope = topeConocido && form.promoActiva && tipoCampana !== "refinanciacion" && descuentoPct > topeDescuento;
  /** Hay descuento ofrecido y no hay hasta cuándo, o la fecha ya pasó. */
  /**
   * Una oferta sin plazo no apura a nadie y queda viva para siempre. Vale igual para el
   * descuento de mora y para la propuesta de cancelación de un castigado — ahí incluso más:
   * dentro de seis meses alguien puede presentarse con el WhatsApp en la mano.
   */
  const ofertaConPlazo = descuentoPct > 0 || esRecupero;
  const promoSinFecha = ofertaConPlazo && !form.promo_vence;
  const promoVencida = ofertaConPlazo && !!form.promo_vence && form.promo_vence < HOY_ISO;

  /*
    QUÉ RECLAMA esta campaña. Viene de la pestaña que la armó (Morosos o Vencimientos).

    🔴 Cambia la ARITMÉTICA, no solo los rótulos. En una de mora la base es lo VENCIDO y hay
    punitorios que se pueden condonar; en una de vencimiento el cliente está AL DÍA, no debe
    nada todavía y lo que se le recuerda es la cuota que viene. Si se calculara igual, cada
    fila mostraría $0,00 —porque `vencido` es cero— y saldría un mensaje diciéndole que debe
    nada a alguien que sí tiene que pagar el jueves.
  */
  /**
   * 🔴 DOS AUDIENCIAS, NO UNA.
   *
   * Pasado el umbral de refinanciación el plan se da por caído y la terminal rechaza el cobro.
   * A esa gente no se le puede mandar "cancelando ahora $X regularizás tu situación": vendría
   * a pagar y el sistema la rechazaría. Y encima se le estarían regalando los punitorios y
   * salteando los honorarios de gestión, que solo se cobran al refinanciar.
   *
   * `cobro_bloqueado` lo decide el SERVER, no estos días de atraso: depende también del
   * acuerdo vigente y de los acuerdos rotos (ver `cobroBloqueadoPorCredito`). El backend
   * vuelve a hacer el corte al crear la campaña; esto es para que se vea antes.
   */
  /**
   * 🔴 Y LA TERCERA: EL QUE ESTÁ AL DÍA NO ES EL QUE ESTÁ EN MORA.
   *
   * El corte de recordatorio no existía acá: `esRecordatorio` salía de un `sessionStorage`
   * que la pestaña Vencimientos escribía y NADIE volvía a poner en "mora". Armando una
   * campaña desde Morosos después de una de vencimientos, la pantalla dibujaba las columnas
   * del recordatorio sobre cinco morosos: los rotulaba "al día" —un literal, no un dato—,
   * mostraba como próximo vencimiento una fecha de hace 28 días y dejaba los punitorios en
   * $0,00. A Rodrigo Benítez le iba a salir "te recordamos que el 10/08/2026 vence tu cuota
   * de $181.819,43" cuando esa fecha ya pasó y debe $206.365,05 con la mora adentro.
   *
   * Ahora la audiencia se DEDUCE de los créditos y no de lo que quedó guardado: los que no
   * tienen nada vencido se recuerdan, los que sí se reclaman, y los que ya no se pueden
   * cobrar se invitan a refinanciar. Tres grupos que nunca se mezclan en un mismo envío.
   */
  /**
   * 🔴 Y LA CUARTA: EL CASTIGADO NO ES UN MOROSO MÁS.
   *
   * A un incobrable no se le reclama: su deuda nominal es varias veces lo que se le prestó
   * —capital, interés capitalizado y punitorios— y mandársela es la forma más rápida de que
   * la conversación se corte. Lo que se le manda es una OFERTA para cancelar.
   *
   * Sin este corte, un castigado caía en "invitar a refinanciar" (por `cobro_bloqueado`), que
   * es justo lo contrario de lo que corresponde: a un incobrable ya no se lo refinancia. Los
   * otros tres grupos lo excluyen explícitamente además de por descarte.
   */
  const { paraRecordar, paraCobrar, paraRefinanciar, paraRecuperar } = useMemo(() => {
    const castigado = (c: Credito) => c.estado === "incobrable";
    return {
      paraRecordar:    todosCreditos.filter((c) => !castigado(c) && !c.cobro_bloqueado && c.dias_mora <= 0),
      paraCobrar:      todosCreditos.filter((c) => !castigado(c) && !c.cobro_bloqueado && c.dias_mora > 0),
      paraRefinanciar: todosCreditos.filter((c) => !castigado(c) && !!c.cobro_bloqueado),
      paraRecuperar:   todosCreditos.filter(castigado),
    };
  }, [todosCreditos]);

  const creditos = esRecupero
    ? paraRecuperar
    : esRefinanciacion ? paraRefinanciar : esRecordatorio ? paraRecordar : paraCobrar;
  /** Las otras audiencias, las que NO entran en esta campaña. Se conservan para la siguiente. */
  const restantes = () =>
    todosCreditos.filter((c) => !creditos.some((x) => x.id === c.id)).map((c) => c.id);

  /**
   * Cambiar de audiencia cambia el texto por defecto — pero solo si el operador no lo tocó.
   * Pisarle un mensaje que escribió a mano por haber clickeado una pestaña sería peor que
   * dejarle el texto equivocado: al menos el equivocado se ve.
   */
  const cambiarTipo = (t: TipoCampana) => {
    setTipoCampana(t);
    setForm((p) => {
      const esDefault = TEMPLATES_DEFAULT.includes(p.mensaje_template.trim());
      if (!esDefault) return p;
      const nuevo = t === "refinanciacion" ? TEMPLATE_REFINANCIACION_DEFAULT
        : t === "vencimiento" ? TEMPLATE_VENCIMIENTO_DEFAULT
        : t === "recupero" ? TEMPLATE_RECUPERO_DEFAULT
        : p.promoActiva ? TEMPLATE_DEFAULT : TEMPLATE_MORA_SIN_PROMO;
      return { ...p, mensaje_template: nuevo };
    });
  };

  /**
   * Si el grupo elegido quedó VACÍO, la pantalla se corrige sola y se planta en uno que tenga
   * gente. No es cosmético: con el tipo colgado de un `sessionStorage` que la pestaña anterior
   * escribió, la vista dibujaba las columnas de un recordatorio sobre cinco morosos —los
   * rotulaba "al día", mostraba una fecha de vencimiento ya pasada y los punitorios en $0,00—
   * y de ahí salía el envío.
   *
   * Se resuelve por orden de preferencia y no caso por caso: con cuatro audiencias, la cadena
   * de ternarios que había ya se había vuelto imposible de leer y de completar sin olvidarse
   * una combinación.
   */
  useEffect(() => {
    const cuantos: Record<TipoCampana, number> = {
      vencimiento: paraRecordar.length,
      mora: paraCobrar.length,
      refinanciacion: paraRefinanciar.length,
      recupero: paraRecuperar.length,
    };
    if (cuantos[tipoCampana] > 0) return;
    const alternativa = (["mora", "vencimiento", "refinanciacion", "recupero"] as TipoCampana[])
      .find((t) => cuantos[t] > 0);
    if (alternativa) cambiarTipo(alternativa);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paraRecordar.length, paraCobrar.length, paraRefinanciar.length, paraRecuperar.length, tipoCampana]);

  // Oferta por crédito (cálculo client-side con el mismo dominio que el server).
  const objetivos = useMemo(
    () =>
      creditos.map((c) => {
        /**
         * 🔴 Sobre lo VENCIDO, no sobre `saldo_pendiente`.
         *
         * El servidor ya calculaba bien la oferta que se le manda al cliente (deuda vencida
         * sin mora + la mora aparte, para poder condonar solo los punitorios). Esta vista
         * previa lo hacía por su cuenta con el saldo del préstamo, así que el admin veía un
         * número y al cliente le llegaba otro. Medido sobre los 3 de una campaña: a un moroso
         * de 5 cuotas le mostraba $663.140,27 MENOS de lo que debía, y a uno de 2 cuotas,
         * $95.956,84 de más — ni siquiera fallaba siempre para el mismo lado.
         *
         * `vencido` viene de `/api/creditos`, que es donde vive la única definición.
         */
        // En un recordatorio no hay mora: la base es la cuota que está por vencer.
        const mora = esRecordatorio ? 0 : (c.interes_mora ?? 0);
        const vencidoSinMora = esRecordatorio
          ? (c.cuota_proxima ?? 0)
          : Math.max(0, (c.vencido ?? 0) - mora);
        const oferta = calculateRecoveryOffer({
          saldo: vencidoSinMora,
          interesMora: mora,
          diasMora: c.dias_mora,
          descuentoPct,
        });

        /**
         * 🔴 LA OFERTA DE UN CASTIGADO SE CALCULA DISTINTO, Y CON EL MISMO MOTOR QUE EL RESTO.
         *
         * No sale de lo vencido con un descuento sobre punitorios: sale del CAPITAL EN RIESGO
         * —lo que salió de la ventanilla en toda la cadena menos todo lo que volvió— ponderado
         * por hace cuánto está castigado y por si apareció a pagar algo. Es `sugerirOferta-
         * Cancelacion`, la misma función que usa la pestaña Incobrables y el cierre del caso,
         * así que el importe del WhatsApp es el mismo que el operador ve cuando el cliente se
         * presenta a pagar.
         *
         * Con un % fijo cargado la campaña lo pisa parejo para todos: es la liquidación de
         * cartera vieja, y se dice como tal en la pantalla.
         */
        const deudaCastigo = c.vencido || c.saldo_pendiente;
        const riesgo = c.capital_en_riesgo ?? 0;
        const sugerida = esRecupero
          ? sugerirOfertaCancelacion(
              {
                capitalEnRiesgo: riesgo,
                deudaReclamada: deudaCastigo,
                diasCastigado: c.incobrable_at
                  ? Math.max(0, Math.floor((hoyComercial().getTime() - new Date(c.incobrable_at).getTime()) / 86_400_000))
                  : 0,
                pagoPostCastigo: (c.cobrado_post_castigo ?? 0) > 0,
              },
              cfgOferta,
            )
          : null;
        const montoRecupero = esRecupero
          ? (pctRecuperoFijo > 0
              ? Math.round(Math.min(deudaCastigo, (riesgo * pctRecuperoFijo) / 100) * 100) / 100
              : (sugerida?.monto ?? deudaCastigo))
          : 0;
        const condonaRecupero = esRecupero ? Math.round(Math.max(0, deudaCastigo - montoRecupero) * 100) / 100 : 0;

        return {
          credito: c, oferta, vencidoSinMora, mora,
          recupero: esRecupero
            ? { deuda: deudaCastigo, riesgo, monto: montoRecupero, condona: condonaRecupero, sugerida }
            : null,
        };
      }),
    [creditos, descuentoPct, esRecordatorio, esRecupero, pctRecuperoFijo, cfgOferta],
  );

  const totalCuotas = esRecupero
    ? objetivos.reduce((s, o) => s + (o.recupero?.deuda ?? 0), 0)
    : objetivos.reduce((s, o) => s + o.vencidoSinMora, 0);
  const totalMora = objetivos.reduce((s, o) => s + o.mora, 0);
  // En recupero el "ahorro" es lo CONDONADO: punitorios, interés del plan y capital.
  const totalAhorro = esRecupero
    ? objetivos.reduce((s, o) => s + (o.recupero?.condona ?? 0), 0)
    : objetivos.reduce((s, o) => s + o.oferta.ahorro, 0);
  const totalOfrecido = esRecupero
    ? objetivos.reduce((s, o) => s + (o.recupero?.monto ?? 0), 0)
    : objetivos.reduce((s, o) => s + o.oferta.montoConDescuento, 0);
  /** Lo que de verdad se perdió: capital prestado que no volvió, sumando la audiencia. */
  const totalRiesgo = objetivos.reduce((s, o) => s + (o.recupero?.riesgo ?? 0), 0);
  const sinTelefono = objetivos.filter((o) => !o.credito.cliente.telefono).length;
  const sinEmail = objetivos.filter((o) => !o.credito.cliente.email).length;

  /** El destinatario de la vista previa: el de la fila enfocada, o el primero de la lista. */
  const objetivoFoco = objetivos.find((o) => o.credito.id === foco) ?? objetivos[0] ?? null;

  const metaElegida = plantillasMeta.find((p) => p.nombre === form.plantilla_meta) ?? null;
  /**
   * El aviso escala con el volumen: acá van cientos de mensajes iguales desde el mismo
   * número, que es exactamente el patrón que Meta penaliza. Nunca bloquea el envío.
   */
  const riesgo = riesgoEnvioMeta({
    // Solo WhatsApp: las políticas de plantillas son de Meta. El SMS y el email tienen sus
    // propias reglas y no es honesto avisar de una restricción que no los alcanza.
    canal: form.canal === "whatsapp" ? "whatsapp" : "email",
    usaPlantillaMeta: !!metaElegida,
    destinatarios: creditos.length,
    hayPlantillas: plantillasMeta.length > 0,
    motivoLabel: "aviso de mora",
  });

  const set = (field: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm((p) => ({ ...p, [field]: e.target.value }));

  const mensajePara = (o: (typeof objetivos)[number]) =>
    construirMensajeCampana(form.mensaje_template, {
      nombre: nombreCompleto(o.credito.cliente),
      // En un recupero [Monto] es lo que se le OFRECE para cancelar, no lo que se le reclama.
      monto: o.recupero ? o.recupero.monto : o.oferta.montoConDescuento,
      saldo: o.credito.saldo_pendiente,
      deuda: o.recupero?.deuda,
      dias: o.credito.dias_mora,
      descuento: o.recupero ? o.recupero.condona : o.oferta.ahorro,
      vence: o.credito.proximo_pago ? formatFecha(o.credito.proximo_pago) : null,
      // La vista previa tiene que mostrar EXACTAMENTE lo que va a salir, plazo incluido.
      promoVence: descuentoPct > 0 && form.promo_vence ? formatFecha(form.promo_vence) : null,
    });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.nombre.trim()) {
      setError("Poné un nombre a la campaña");
      return;
    }
    // Redundante con el `disabled` del botón y con el 403 del servidor, a propósito: es el
    // único de los tres que explica el motivo si alguien llega igual (Enter en un campo).
    if (promoSinFecha || promoVencida) {
      setError(
        promoSinFecha
          ? "El descuento necesita una fecha de vencimiento: hasta cuándo puede acogerse el cliente."
          : "La fecha del descuento ya pasó. Poné hoy o una fecha posterior.",
      );
      return;
    }
    if (excedeTope) {
      setError(
        topeDescuento === 0
          ? "No podés ofrecer descuento en una campaña. Pedile a un administrador que la arme."
          : `El descuento máximo que podés ofrecer es ${topeDescuento}% de los punitorios.`,
      );
      return;
    }
    const ok = await confirm({
      title: "¿Crear campaña?",
      description:
        `Se creará la campaña "${form.nombre.trim()}" con ${creditos.length} crédito${creditos.length !== 1 ? "s" : ""} ` +
        (esRecupero
          ? "dados por incobrables, ofreciéndoles cancelar"
          : esRefinanciacion
            ? "cuyo plan ya venció, invitándolos a refinanciar"
            : esRecordatorio ? "por vencer" : "en mora") +
        ` por ${CANAL_META[form.canal].label}.` +
        // Que quede dicho ANTES de crear: la otra mitad de la selección sigue esperando.
        (restantes().length > 0
          ? ` Los otros ${restantes().length} quedan seleccionados para su propia campaña.`
          : ""),
      confirmLabel: "Crear campaña",
    });
    if (!ok) return;
    setLoading(true);
    setError(null);
    try {
      const body = {
        nombre: form.nombre.trim(),
        descripcion: form.descripcion.trim() || undefined,
        canal: form.canal,
        // En un recupero la quita es sobre el TOTAL (punitorios, interés y capital), no sobre
        // los punitorios: se resigna plata prestada y tiene que quedar registrado como tal.
        promo_tipo: esRecupero ? "quita_total" : form.promoActiva ? "quita_interes" : "ninguna",
        // Y el valor no es un descuento: es qué % del capital en riesgo se le pide a cada uno.
        // 0 = la sugerencia del motor, caso por caso.
        promo_valor: esRecupero ? pctRecuperoFijo : descuentoPct,
        promo_vence: form.promo_vence || undefined,
        mensaje_template: form.mensaje_template.trim() || undefined,
        // Qué reclama la campaña: sin esto, un recordatorio quedaba guardado como reclamo de
        // mora y en la lista de campañas viejas no habría forma de distinguirlos.
        tipo: tipoCampana,
        // Con qué plantilla salió. Si Meta observa el número hay que poder decir qué campañas
        // usaron una plantilla aprobada y cuáles salieron como texto libre.
        plantilla_meta: form.plantilla_meta || undefined,
        credito_ids: creditos.map((c) => c.id),
      };
      const res = await fetch("/api/cobranza/campanas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!json.ok) {
        setError(json.error || "No se pudo crear la campaña");
        return;
      }
      // WhatsApp y Email pasan al paso de lanzamiento; SMS cierra directamente.
      if (form.canal === "whatsapp" || form.canal === "email") {
        setCampanaId(json.data?.id ?? null);
        setLaunched(true);
      } else {
        toast.success("Campaña creada");
        onTerminar(restantes());
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error");
    } finally {
      setLoading(false);
    }
  };

  const abrirWhatsapp = (o: (typeof objetivos)[number]) => {
    window.open(linkWhatsapp(o.credito.cliente.telefono, mensajePara(o)), "_blank");
    setEnviados((prev) => new Set(prev).add(o.credito.id));
  };

  const enviarPorApi = async () => {
    if (!campanaId) return;
    const ok = await confirm({
      title: "¿Enviar la campaña?",
      description: `Se enviará el mensaje a ${objetivos.length} cliente${objetivos.length !== 1 ? "s" : ""} por ${CANAL_META[form.canal].label}. Esta acción contacta a los clientes y no se puede deshacer.`,
      confirmLabel: "Enviar ahora",
    });
    if (!ok) return;
    setEnviandoApi(true);
    setError(null);
    setProgreso(null);
    try {
      /**
       * 🔴 SE LLAMA POR TANDAS HASTA TERMINAR.
       *
       * El envío es secuencial y una función de Vercel se corta a los 60 segundos, así que
       * el servidor manda lo que le entra en ese rato y devuelve `quedan_pendientes`. Con
       * una sola llamada, una campaña de 50 clientes moría a la mitad y —peor— no había
       * forma de saber a quiénes les había llegado.
       *
       * Los ya enviados quedan marcados en la base, así que cada vuelta toma solo los que
       * faltan: nadie recibe el mensaje dos veces.
       */
      const yaEnviados = new Set<string>();
      let vueltas = 0;
      for (;;) {
        const res = await fetch(`/api/cobranza/campanas/${campanaId}/enviar`, { method: "POST" });
        const json = await res.json();
        if (!json.ok) {
          setError(json.error || "Error al enviar");
          toast.error(json.error || "Error al enviar");
          return;
        }

        for (const r of (json.data.resultados ?? []) as { cliente_id: string; ok?: boolean }[]) {
          if (r.ok !== false) yaEnviados.add(r.cliente_id);
        }
        setEnviados(new Set(yaEnviados));
        setProgreso(json.data.progreso ?? null);

        if (!json.data.quedan_pendientes) break;
        // Guarda contra un bucle infinito si una tanda dejara de avanzar (por ejemplo, el
        // email sin configurar: esos objetivos quedan pendientes a propósito).
        if ((json.data.progreso?.procesados ?? 0) === 0 || ++vueltas > 40) {
          setError("El envío se detuvo con destinatarios pendientes. Revisá la configuración del canal y volvé a intentar.");
          return;
        }
      }

      const total = objetivos.length;
      toast.success(`Campaña enviada a ${yaEnviados.size} de ${total} cliente${total !== 1 ? "s" : ""}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    } finally {
      setEnviandoApi(false);
    }
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // Paso 2: lanzamiento
  // ─────────────────────────────────────────────────────────────────────────────
  if (launched) {
    const todosMarcados = objetivos.length > 0 && objetivos.every((o) => enviados.has(o.credito.id));
    const esEmail = form.canal === "email";
    return (
      <div className="flex h-full min-h-0 flex-col">
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-4xl space-y-4 p-5">
            <div className="flex items-center gap-2.5 rounded-lg border border-success/30 bg-success/5 px-4 py-3">
              <Check className="h-4 w-4 shrink-0 text-success" />
              <p className="text-sm text-success">
                Campaña «{form.nombre.trim()}» creada.{" "}
                {esEmail
                  ? `Enviá los emails a los ${objetivos.length} cliente${objetivos.length !== 1 ? "s" : ""} de la campaña.`
                  : whatsappApiActiva
                    ? "Podés enviar todo vía API de WhatsApp o abrir cada conversación manualmente."
                    : "Abrí el WhatsApp de cada cliente para enviar el mensaje."}
              </p>
            </div>

            {error && (
              <div className="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>
            )}

            {/* Botón de envío masivo vía API */}
            {(esEmail || whatsappApiActiva) && !todosMarcados && (
              <button
                onClick={enviarPorApi}
                disabled={enviandoApi}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-success py-2.5 text-sm font-medium text-success-foreground transition-colors hover:bg-success/90 disabled:opacity-50"
              >
                {enviandoApi ? <Loader2 className="h-4 w-4 animate-spin" /> : esEmail ? <Mail className="h-4 w-4" /> : <WhatsAppIcon className="h-4 w-4" />}
                {enviandoApi
                  ? // Con muchos destinatarios el envío tarda: sin el contador, un botón que dice
                    // "Enviando…" durante un minuto parece colgado y alguien lo va a recargar.
                    progreso
                    ? `Enviando… ${progreso.enviados} de ${progreso.enviados + progreso.pendientes}`
                    : "Enviando…"
                  : esEmail
                    ? `Enviar ${objetivos.length} email${objetivos.length !== 1 ? "s" : ""}`
                    : `Enviar ${objetivos.length} mensajes vía WhatsApp API`}
              </button>
            )}

            {progreso && !enviandoApi && progreso.pendientes > 0 && (
              <p className="rounded-lg border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-warning">
                Quedaron {progreso.pendientes} sin enviar. Los que ya salieron no se repiten: volvé a
                apretar Enviar y sigue por donde se cortó.
              </p>
            )}

            <div className="overflow-hidden rounded-xl border border-border">
              <div className="flex items-center justify-between gap-3 border-b border-border bg-muted/30 px-4 py-2.5">
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Destinatarios</p>
                <p className="text-xs tabular-nums text-muted-foreground">
                  <span className="font-semibold text-foreground">{enviados.size}</span> de {objetivos.length} enviados
                </p>
              </div>
              <div className="divide-y divide-border/50">
                {objetivos.map((o) => {
                  const enviado = enviados.has(o.credito.id);
                  const sinContacto = esEmail ? !o.credito.cliente.email : !o.credito.cliente.telefono;
                  return (
                    <div key={o.credito.id} className="flex items-center justify-between gap-3 px-4 py-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-foreground">{nombreCompleto(o.credito.cliente)}</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          Se le pide{" "}
                          <span className="font-mono tabular-nums text-foreground">{formatMonto(o.oferta.montoConDescuento)}</span>
                          {o.oferta.ahorro > 0 && (
                            <>
                              {" · descuento de "}
                              <span className="font-mono tabular-nums text-success">{formatMonto(o.oferta.ahorro)}</span>
                            </>
                          )}
                          {sinContacto && <span className="text-warning"> · sin {esEmail ? "email" : "teléfono"}</span>}
                        </p>
                      </div>
                      {/* Manual WhatsApp (solo para canal whatsapp) */}
                      {!esEmail && (
                        <button
                          onClick={() => abrirWhatsapp(o)}
                          disabled={sinContacto}
                          className={`flex shrink-0 items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                            enviado
                              ? "border-success/30 bg-success/10 text-success"
                              : sinContacto
                                ? "cursor-not-allowed border-border text-muted-foreground opacity-40"
                                : "border-primary/20 bg-primary/10 text-primary hover:bg-primary/20"
                          }`}
                        >
                          {enviado ? <Check className="h-3.5 w-3.5" /> : <WhatsAppIcon className="h-3.5 w-3.5" />}
                          {enviado ? "Enviado" : "Manual"}
                        </button>
                      )}
                      {/* Estado de envío para email */}
                      {esEmail && enviado && (
                        <span className="flex items-center gap-1 text-xs font-medium text-success">
                          <Check className="h-3.5 w-3.5" /> Enviado
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        <div className="flex shrink-0 items-center justify-end gap-3 border-t border-edge bg-card/40 px-5 py-3">
          <button
            onClick={() => onTerminar(restantes())}
            className="rounded-lg bg-primary px-5 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
          >
            Listo
          </button>
        </div>
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Paso 1: configuración
  // ─────────────────────────────────────────────────────────────────────────────
  return (
    <form onSubmit={handleSubmit} className="flex h-full min-h-0 flex-col">
      {/* Dos columnas con scroll propio en desktop; apiladas y con un solo scroll en mobile
          —dos áreas scrolleables una al lado de la otra en 400px de ancho no son usables. */}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto md:flex-row md:overflow-hidden">
        {/* ── IZQUIERDA: qué se manda ── */}
        <div className="flex w-full shrink-0 flex-col border-b border-edge bg-card/40 md:w-[340px] md:border-b-0 md:border-r xl:w-[380px]">
          <div className="space-y-4 p-4 md:min-h-0 md:flex-1 md:overflow-y-auto">
            {error && (
              <div className="rounded-lg border border-destructive/20 bg-destructive/10 px-2.5 py-2 text-sm text-destructive">{error}</div>
            )}

            <section className="space-y-2.5">
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Identificación</p>
              <Field label="Nombre de la campaña" required>
                <Input placeholder="Ej: Recupero Junio" value={form.nombre} onChange={set("nombre")} />
              </Field>
              <Field label="Descripción">
                <Input placeholder="Objetivo de la campaña (opcional)" value={form.descripcion} onChange={set("descripcion")} />
              </Field>
            </section>

            <section className="space-y-2.5">
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Canal</p>
              <div className="grid grid-cols-3 gap-2">
                {(Object.keys(CANAL_META) as CanalCampana[]).map((k) => {
                  const { label, icon: Icon } = CANAL_META[k];
                  const activo = form.canal === k;
                  return (
                    <button
                      key={k}
                      type="button"
                      onClick={() =>
                        setForm((p) => ({
                          ...p,
                          canal: k,
                          // Una plantilla de Meta es de WhatsApp: cambiando de canal deja de
                          // aplicar, y el mensaje vuelve a ser editable.
                          ...(k !== "whatsapp" && p.plantilla_meta
                            ? { plantilla_meta: "", mensaje_template: TEMPLATE_DEFAULT }
                            : {}),
                        }))
                      }
                      className={`flex flex-col items-center gap-1.5 rounded-lg border px-2 py-2.5 text-xs font-medium transition-colors ${
                        activo
                          ? "border-primary/40 bg-primary/10 text-primary"
                          : "border-border text-muted-foreground hover:bg-muted/40 hover:text-foreground"
                      }`}
                    >
                      <Icon className="h-4 w-4" />
                      {label}
                    </button>
                  );
                })}
              </div>
              {/* Cuántos de la audiencia no tienen ese dato cargado: es el número que decide si
                  este canal sirve para esta campaña, y se sabe ANTES de crearla. */}
              {form.canal === "whatsapp" && sinTelefono > 0 && (
                <p className="text-[11px] text-warning">
                  <span className="font-semibold tabular-nums">{sinTelefono}</span> de {objetivos.length} sin teléfono cargado
                </p>
              )}
              {form.canal === "email" && sinEmail > 0 && (
                <p className="text-[11px] text-warning">
                  <span className="font-semibold tabular-nums">{sinEmail}</span> de {objetivos.length} sin email cargado
                </p>
              )}
            </section>

            {/* Promoción */}
            {/*
              El incentivo es "descuento de intereses de MORA". En un recordatorio no hay mora
              todavía: no hay nada que descontar, y ofrecer un descuento del 0% de $0,00 sería
              prometerle algo vacío al cliente. El bloque entero no se muestra.
            */}
            {!esRecordatorio && !esRefinanciacion && !esRecupero && (
            <section className="space-y-2.5">
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Incentivo</p>
              <div className={`space-y-3 rounded-lg border p-3 transition-colors ${form.promoActiva ? "border-success/30 bg-success/5" : "border-border"}`}>
                <label className="flex cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    checked={form.promoActiva}
                    onChange={(e) => {
                      const activa = e.target.checked;
                      setForm((p) => {
                        /**
                         * Prender o apagar el descuento cambia el texto por defecto: el de la
                         * promo nombra el plazo (`[Promo_vence]`) y sin promo esa variable
                         * queda vacía, dejando "hasta el " en el medio de la frase. Igual que
                         * al cambiar de audiencia, un texto escrito a mano no se pisa.
                         */
                        const esDefault = TEMPLATES_DEFAULT.includes(p.mensaje_template.trim());
                        if (!esDefault || tipoCampana !== "mora") return { ...p, promoActiva: activa };
                        return {
                          ...p,
                          promoActiva: activa,
                          mensaje_template: activa ? TEMPLATE_DEFAULT : TEMPLATE_MORA_SIN_PROMO,
                        };
                      });
                    }}
                    className="h-4 w-4 rounded border-border accent-success"
                  />
                  <span className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                    <Sparkles className="h-3.5 w-3.5 text-success" /> Descuento de intereses de mora
                  </span>
                </label>
                {form.promoActiva && (
                  <>
                    <div className="grid grid-cols-2 gap-2.5">
                      <Field label="% sobre punitorios">
                        <Input
                          type="number" min="0" max={topeConocido ? topeDescuento : 100} step="5"
                          value={form.promo_valor} onChange={set("promo_valor")}
                          aria-invalid={excedeTope}
                          className={excedeTope ? "border-destructive focus:ring-destructive/20" : undefined}
                        />
                      </Field>
                      {/* El calendario no deja elegir ayer: un descuento que nace vencido no
                          descuenta nada y el cliente se entera al llegar a pagar. */}
                      <Field label="Válida hasta" hint="Último día para acogerse">
                        <Input
                          type="date"
                          value={form.promo_vence}
                          min={HOY_ISO}
                          onChange={set("promo_vence")}
                          aria-invalid={promoSinFecha || promoVencida}
                          className={promoSinFecha || promoVencida ? "border-destructive focus:ring-destructive/20" : undefined}
                        />
                      </Field>
                    </div>
                    {/* El descuento sale SOLO de los punitorios: el capital y el interés pactado no
                        se tocan. Con el tope a la vista se entiende por qué subir el % deja de
                        cambiar el total en algún momento. */}
                    {excedeTope ? (
                      <p className="text-[11px] font-medium text-destructive">
                        {topeDescuento === 0
                          ? "No podés ofrecer descuento en una campaña. Pedile a un administrador que la arme."
                          : `Te pasaste del tope: como máximo podés ofrecer ${topeDescuento}% de los punitorios.`}
                      </p>
                    ) : promoSinFecha || promoVencida ? (
                      <p className="text-[11px] font-medium text-destructive">
                        {promoSinFecha
                          ? "Poné hasta cuándo vale el descuento. Sin fecha se les sigue aplicando para siempre, cada vez que paguen."
                          : "Esa fecha ya pasó: el descuento nacería vencido y al cliente se le cobrarían los punitorios enteros."}
                      </p>
                    ) : (
                      <p className="text-[11px] text-muted-foreground">
                        Punitorios de la audiencia:{" "}
                        <span className="font-mono tabular-nums text-foreground">{formatMonto(totalMora)}</span> — es todo lo
                        que se puede descontar
                        {topeConocido && topeDescuento < 100 && <>, y vos podés descontar hasta {topeDescuento}%</>}.
                      </p>
                    )}
                  </>
                )}
              </div>
            </section>
            )}

            {/*
              ── LA OFERTA DE RECUPERO ──

              No es el bloque de incentivo con otro nombre. Allá se descuentan PUNITORIOS
              sobre una deuda viva; acá se resigna capital de una deuda ya dada por perdida, y
              lo que se define no es un descuento sino cuánto se le pide a cada uno.

              Por eso el número que manda es el capital en riesgo —la plata que de verdad
              salió de la ventanilla y no volvió— y no la deuda nominal, que está inflada por
              su propio interés.
            */}
            {esRecupero && (
              <section className="space-y-2.5">
                <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">La oferta</p>
                <div className="space-y-3 rounded-lg border border-success/30 bg-success/5 p-3">
                  <p className="text-[11px] leading-relaxed text-muted-foreground">
                    A cada uno se le ofrece lo que calcula el motor de recupero según hace cuánto
                    está castigado y si apareció a pagar algo. Del total prestado y no recuperado
                    —<span className="font-mono tabular-nums text-destructive">{formatMonto(totalRiesgo)}</span>— se
                    ofrece recuperar <span className="font-mono tabular-nums text-success">{formatMonto(totalOfrecido)}</span>.
                  </p>
                  <label className="flex cursor-pointer items-start gap-2">
                    <input
                      type="checkbox"
                      checked={form.recuperoPctFijo}
                      onChange={(e) => setForm((p) => ({ ...p, recuperoPctFijo: e.target.checked }))}
                      className="mt-0.5 h-4 w-4 rounded border-border accent-success"
                    />
                    <span className="text-sm font-medium text-foreground">
                      Un mismo porcentaje para todos
                      <span className="mt-0.5 block text-[11px] font-normal text-muted-foreground">
                        Liquidación de cartera vieja: pisa la sugerencia caso por caso.
                      </span>
                    </span>
                  </label>
                  {form.recuperoPctFijo && (
                    <Field label="% del capital en riesgo" hint="Sobre lo prestado que no volvió, no sobre la deuda">
                      <Input type="number" min="0" max="100" step="5" value={form.recupero_pct} onChange={set("recupero_pct")} />
                    </Field>
                  )}
                  <Field label="Válida hasta" hint="Último día para aceptar la propuesta">
                    <Input
                      type="date"
                      value={form.promo_vence}
                      min={HOY_ISO}
                      onChange={set("promo_vence")}
                      aria-invalid={promoSinFecha || promoVencida}
                      className={promoSinFecha || promoVencida ? "border-destructive focus:ring-destructive/20" : undefined}
                    />
                  </Field>
                  {(promoSinFecha || promoVencida) && (
                    <p className="text-[11px] font-medium text-destructive">
                      {promoSinFecha
                        ? "Poné hasta cuándo vale la propuesta. Sin fecha queda viva para siempre y dentro de seis meses alguien se presenta con el mensaje en la mano."
                        : "Esa fecha ya pasó: la oferta nacería vencida."}
                    </p>
                  )}
                </div>
              </section>
            )}

            {/* ── Plantilla aprobada por Meta (opcional, solo WhatsApp) ── */}
            <section className="space-y-2.5">
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Mensaje</p>

              {form.canal === "whatsapp" && plantillasMeta.length > 0 && (
                <Field
                  label="Plantilla aprobada por Meta"
                  hint={
                    metaElegida
                      ? "El cuerpo lo fija Meta y no se edita: cambiarlo invalida la aprobación."
                      : "Opcional. Con una plantilla aprobada el mensaje se entrega aunque el cliente no te haya escrito antes."
                  }
                >
                  <Select
                    value={form.plantilla_meta}
                    onChange={(e) => {
                      const nombre = e.target.value;
                      const p = plantillasMeta.find((x) => x.nombre === nombre);
                      setForm((prev) => ({
                        ...prev,
                        plantilla_meta: nombre,
                        // Al elegirla, el mensaje pasa a ser el suyo; al volver a texto libre, el default.
                        mensaje_template: p ? p.template : TEMPLATE_DEFAULT,
                      }));
                    }}
                  >
                    <option value="">Texto libre (sin plantilla)</option>
                    {plantillasMeta.map((p) => (
                      <option key={p.id} value={p.nombre} disabled={p.faltantes.length > 0}>
                        {p.nombre} · {p.idioma} · {CATEGORIA_META_LABEL[p.categoria]}
                        {p.faltantes.length > 0 ? ` — no sirve para campañas (usa: ${p.faltantes.join(", ")})` : ""}
                      </option>
                    ))}
                  </Select>
                </Field>
              )}

              <Field
                label="Texto"
                hint={
                  metaElegida
                    ? "Texto aprobado por Meta. Las variables se completan con los datos de cada cliente."
                    : "Placeholders: [Nombre] [Monto] [Saldo] [Dias] [Descuento]"
                }
              >
                <Textarea
                  rows={5}
                  value={form.mensaje_template}
                  onChange={set("mensaje_template")}
                  // Una plantilla aprobada no se edita: Meta aprueba un texto exacto.
                  readOnly={!!metaElegida}
                  className={metaElegida ? "cursor-not-allowed border-success/30 bg-success/5" : undefined}
                />
              </Field>

              {/*
                El mensaje YA RESUELTO, con los datos del destinatario que el operador tenga
                enfocado en la tabla. En el modal no entraba, así que los placeholders se
                mandaban a ciegas: un `[Monto]` mal escrito salía como texto literal a toda la
                audiencia y recién se veía en el WhatsApp del cliente.
              */}
              {objetivoFoco && (
                <div className="rounded-lg border border-border bg-muted/20 p-3">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                    Así lo recibe {nombreCompleto(objetivoFoco.credito.cliente)}
                  </p>
                  {/* La animación es el acuse de recibo del click en la fila: sin ella, cambiar
                      de cliente reescribe el texto en el lugar y no se nota que respondió. */}
                  <AnimatePresence mode="wait">
                    <motion.p
                      key={objetivoFoco.credito.id + form.mensaje_template + descuentoPct}
                      initial={reducirMovimiento ? false : { opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={reducirMovimiento ? undefined : { opacity: 0, y: -6 }}
                      transition={{ duration: 0.18 }}
                      className="mt-2 whitespace-pre-wrap break-words rounded-lg bg-success/10 px-3 py-2 text-xs leading-relaxed text-foreground"
                    >
                      {mensajePara(objetivoFoco)}
                    </motion.p>
                  </AnimatePresence>
                </div>
              )}

              {/*
                🔴 [Monto] EN UNA INVITACIÓN A REFINANCIAR ES EL BUG QUE ESTA PANTALLA EVITA.

                El importe que resuelve el placeholder es lo VENCIDO hoy. Al refinanciar se
                consolida el plan entero —incluidas las cuotas que todavía no vencieron— así
                que el número del mensaje va a ser menor que el que se le va a pedir cuando
                venga. La plantilla por defecto no lo usa; esto cubre al que lo escriba a mano.

                Avisa, no bloquea: puede haber un texto donde el importe tenga sentido ("hoy
                debés $X vencidos"), y decidirlo es del que escribe.
              */}
              {esRefinanciacion && /\[monto\]/i.test(form.mensaje_template) && (
                <div className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-[11px] leading-relaxed text-foreground">
                  <strong>Ojo con [Monto]:</strong> resuelve lo <strong>vencido hoy</strong>, no la deuda que se
                  consolida al refinanciar —que se lleva también las cuotas por vencer y crece con la mora—. El
                  cliente va a leer un importe y al llegar se le va a pedir otro.
                </div>
              )}

              {/* ── Aviso de políticas de Meta. Informa, no bloquea. ── */}
              {riesgo.nivel && <AvisoMeta nivel={riesgo.nivel} titulo={riesgo.titulo} puntos={riesgo.puntos} />}
            </section>
          </div>
        </div>

        {/* ── DERECHA: a quién le llega y cuánto se le pide ── */}
        <div className="flex min-w-0 flex-1 flex-col md:min-h-0">
          <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-edge px-5 py-3">
            <Users className="h-4 w-4 text-primary" />
            <h2 className="text-sm font-semibold text-foreground">
              {objetivos.length} destinatario{objetivos.length !== 1 ? "s" : ""}
            </h2>
            {bloqueados > 0 && (
              <span className="rounded border border-warning/30 bg-warning/10 px-1.5 py-0.5 text-[11px] text-warning">
                {bloqueados} excluido{bloqueados !== 1 ? "s" : ""} por no contactar
              </span>
            )}
          </div>

          {/*
            ── EL CORTE ENTRE LAS AUDIENCIAS ──

            🔴 Estaba metido en el renglón del título, en `text-xs`, apretado contra el conteo
            de destinatarios: el control que cambia la campaña ENTERA —a quiénes se les manda,
            qué mensaje, qué incentivo y qué importe— parecía un filtro de tabla. Se leía
            tarde o no se leía, y el operador armaba el envío sin saber que la selección traía
            dos grupos distintos.

            Ahora es su propia banda arriba de la lista, del ancho de lo que modifica, con el
            grupo activo marcado y el otro dicho como lo que es: gente que queda para su
            propia campaña, no una opción escondida.
          */}
          {(() => {
            const grupos = ([
              { t: "vencimiento" as TipoCampana,    label: "Recordar el vencimiento", detalle: "todavía no deben nada",         n: paraRecordar.length },
              { t: "mora" as TipoCampana,           label: "Reclamar el pago",        detalle: "con punitorios",                n: paraCobrar.length },
              { t: "refinanciacion" as TipoCampana, label: "Invitar a refinanciar",   detalle: "su plan ya no se puede cobrar", n: paraRefinanciar.length },
              { t: "recupero" as TipoCampana,       label: "Ofrecer cancelación",     detalle: "deuda dada por perdida",        n: paraRecuperar.length },
            ]).filter((g) => g.n > 0);
            if (grupos.length < 2) return null;
            return (
              <div className="shrink-0 border-b border-edge bg-muted/[0.04] px-5 py-3">
                <p className="mb-2 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                  La selección trae {grupos.length} grupos · se manda uno por vez
                </p>
                <div className="flex flex-wrap gap-2">
                  {grupos.map(({ t, label, detalle, n }) => {
                    const activo = tipoCampana === t;
                    return (
                      <button
                        key={t}
                        type="button"
                        onClick={() => cambiarTipo(t)}
                        aria-pressed={activo}
                        className={`flex min-w-[11rem] flex-1 items-center gap-3 rounded-xl border px-3.5 py-2.5 text-left transition-colors ${
                          activo
                            ? "border-primary bg-primary/10 ring-1 ring-primary/30"
                            : "border-border bg-card hover:border-border hover:bg-muted/40"
                        }`}
                      >
                        <span
                          className={`flex h-8 min-w-8 items-center justify-center rounded-lg px-1.5 font-mono text-sm font-bold tabular-nums ${
                            activo ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                          }`}
                        >
                          {n}
                        </span>
                        <span className="min-w-0">
                          <span className={`block truncate text-sm font-semibold ${activo ? "text-foreground" : "text-muted-foreground"}`}>
                            {label}
                          </span>
                          <span className="block truncate text-[11px] text-muted-foreground">{detalle}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })()}

          {/*
            Por qué estos créditos no van en la misma campaña que los demás. Es el dato que
            explica el corte de arriba, y va una sola vez arriba de la tabla — no repetido en
            cada fila.
          */}
          {esRecupero && (
            <div className="shrink-0 border-b border-edge bg-success/[0.06] px-5 py-2.5 text-xs leading-relaxed text-foreground">
              Estas deudas ya se dieron por perdidas. Lo que se manda no es un reclamo sino una
              propuesta para cerrar: se ofrece un importe y se <strong>condona el resto</strong>
              {" "}—punitorios, interés del plan y capital—. Cuando el cliente acepte, el caso se
              cierra desde la pestaña Incobrables.
            </div>
          )}

          {esRefinanciacion && (
            <div className="shrink-0 border-b border-edge bg-warning/[0.06] px-5 py-2.5 text-xs text-foreground">
              El plan de pagos de estos créditos ya venció: la terminal de cobro los rechaza. Al
              refinanciar se consolida <strong>todo el plan</strong>, no solo lo vencido que se ve
              acá, y ahí se aplican los honorarios por gestión de cobranza.
            </div>
          )}

          <div className="md:min-h-0 md:flex-1 overflow-auto">
            <TablaAudiencia
              objetivos={objetivos}
              totales={{ totalCuotas, totalMora, totalAhorro, totalOfrecido }}
              focoId={objetivoFoco?.credito.id ?? null}
              esRecordatorio={esRecordatorio}
              esRefinanciacion={esRefinanciacion}
              esRecupero={esRecupero}
              onFoco={setFoco}
            />
          </div>
        </div>
      </div>

      {/* ── Barra de acción: el pipeline del cálculo + los botones ──
          El desglose vive ACÁ y no arriba de la tabla: es el número sobre el que se aprieta
          "Crear campaña", así que tiene que estar al lado del botón, no a dos paneles de
          distancia. Además le devuelve a la tabla el alto que le comía la cabecera. */}
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-6 gap-y-3 border-t border-edge bg-card/40 px-5 py-2.5">
        <PipelineReclamo
          cuotas={totalCuotas}
          punitorios={totalMora}
          descuento={totalAhorro}
          total={totalOfrecido}
          esRefinanciacion={esRefinanciacion}
          esRecordatorio={esRecordatorio}
          esRecupero={esRecupero}
          reducir={!!reducirMovimiento}
        />
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onCancelar}
            className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={loading || excedeTope || promoSinFecha || promoVencida}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-5 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            {loading ? "Creando…" : "Crear campaña"}
          </button>
        </div>
      </div>
    </form>
  );
}

/**
 * El cálculo del reclamo como un PIPELINE, no como una frase.
 *
 * 🔴 Antes esto era un renglón de texto ("Se reclama lo VENCIDO —cuotas impagas +
 * punitorios—, no el total del crédito"): explicaba la fórmula con palabras al lado de una
 * tabla que la mostraba con números, y nadie lee un pie de página cuando tiene los importes
 * enfrente. Ahora la fórmula ES el gráfico —las mismas cuatro etapas que las columnas de la
 * tabla, en el mismo orden, con los totales de la campaña—, así que se entiende de dónde sale
 * el número final sin traducir nada. El "paquete" que viaja por cada tramo es lo que hace
 * leer los cuatro nodos como un flujo y no como cuatro cifras sueltas.
 */
function PipelineReclamo({
  cuotas, punitorios, descuento, total, reducir, esRefinanciacion, esRecordatorio, esRecupero,
}: {
  cuotas: number; punitorios: number; descuento: number; total: number; reducir: boolean;
  /**
   * Oferta de recupero: la fórmula es otra y los rótulos también. Acá "cuotas" trae la deuda
   * nominal entera y "descuento" lo condonado —que incluye capital—, así que dejar los
   * nombres de la barra de mora diría "Cuotas vencidas − Descuento" sobre una operación
   * donde lo que se resigna es plata prestada.
   */
  esRecupero?: boolean;
  /** Invitación a refinanciar: no hay descuento, y el resultado no es lo que se le pide. */
  esRefinanciacion?: boolean;
  /**
   * Recordatorio: no hay nada vencido, así que no hay fórmula. Faltaba este caso y la barra
   * seguía diciendo "Cuotas vencidas + Punitorios − Descuento = Se le pide" mientras la tabla
   * de arriba, en la misma pantalla, encabezaba "Se le recuerda". Dos vocabularios para el
   * mismo envío, y el de abajo hablaba de una deuda que estos clientes no tienen.
   */
  esRecordatorio?: boolean;
}) {
  const etapas = esRecupero
    ? [
        { label: "Se le reclama", valor: cuotas,    tono: "text-muted-foreground", op: "−" },
        { label: "Se condona",    valor: descuento, tono: "text-warning",          op: "=" },
        { label: "Se le ofrece",  valor: total,     tono: "text-success",          op: null },
      ]
    : esRecordatorio
    ? [{ label: "Se le recuerda", valor: total, tono: "text-foreground", op: null }]
    : esRefinanciacion
    // Sin etapa de descuento: no hay ninguno que ofrecer. Y el resultado es lo que deben HOY,
    // no lo que se les reclama — la refinanciación se lleva además lo que todavía no venció.
    ? [
        { label: "Cuotas vencidas", valor: cuotas,     tono: "text-foreground", op: "+" },
        { label: "Punitorios",      valor: punitorios, tono: "text-warning",    op: "=" },
        { label: "Vencido hoy",     valor: total,      tono: "text-foreground", op: null },
      ]
    : [
    { label: "Cuotas vencidas", valor: cuotas,     tono: "text-foreground",  op: "+" },
    { label: "Punitorios",      valor: punitorios, tono: "text-warning",     op: "−" },
    { label: "Descuento",       valor: descuento,  tono: "text-success",     op: "=" },
    { label: "Se le pide",      valor: total,      tono: "text-foreground",  op: null },
  ];

  return (
    <div className="flex flex-wrap items-center gap-y-2">
      {etapas.map((e, i) => (
        <Fragment key={e.label}>
          <motion.div
            initial={reducir ? false : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25, delay: reducir ? 0 : i * 0.07 }}
            className={`rounded-lg border px-2.5 py-1.5 ${
              // La última etapa es el resultado, no un sumando: se la marca como tal.
              e.op === null ? "border-primary/40 bg-primary/10" : "border-border bg-muted/20"
            }`}
          >
            <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">{e.label}</p>
            <p className={`font-mono text-sm font-semibold tabular-nums ${e.tono}`}>{formatMonto(e.valor)}</p>
          </motion.div>
          {e.op && <TramoPipeline op={e.op} indice={i} reducir={reducir} />}
        </Fragment>
      ))}
    </div>
  );
}

/** Un tramo del pipeline: la línea, el operador y el paquete que lo recorre. */
function TramoPipeline({ op, indice, reducir }: { op: string; indice: number; reducir: boolean }) {
  return (
    <div className="relative mx-1.5 flex h-8 w-9 shrink-0 items-center sm:mx-2 sm:w-12" aria-hidden>
      <div className="h-px w-full bg-border" />
      {!reducir && (
        <motion.span
          className="absolute top-1/2 h-1.5 w-1.5 -translate-y-1/2 rounded-full bg-primary"
          initial={{ left: "0%", opacity: 0 }}
          animate={{ left: ["0%", "100%"], opacity: [0, 1, 1, 0] }}
          transition={{ duration: 1.9, repeat: Infinity, delay: indice * 0.45, ease: "easeInOut" }}
        />
      )}
      <span className="absolute left-1/2 z-10 -translate-x-1/2 rounded-full border border-border bg-card px-1.5 text-[11px] font-bold leading-4 text-muted-foreground">
        {op}
      </span>
    </div>
  );
}

/**
 * La audiencia como TABLA, no como texto corrido.
 *
 * 🔴 El reclamo se compone de tres cosas distintas y antes iban todas en una misma frase
 * ("$1.313.140,27 de cuotas + $885.056,56 de punitorios − $442.528,28 de descuento"), así que no
 * se sabía si el número grande era una cuota, el total del crédito o lo vencido. Con una
 * columna por concepto, cada importe se lee contra su encabezado y las filas se comparan
 * entre sí. El pie suma lo mismo que la barra de abajo: son los números que salen en los
 * mensajes.
 */
function TablaAudiencia({
  objetivos,
  totales,
  focoId,
  onFoco,
  esRecordatorio,
  esRefinanciacion,
  esRecupero,
}: {
  objetivos: {
    credito: Credito;
    oferta: { montoConDescuento: number; ahorro: number };
    vencidoSinMora: number;
    mora: number;
    /** Solo en las campañas de recupero: la propuesta de cancelación de ese castigado. */
    recupero: { deuda: number; riesgo: number; monto: number; condona: number } | null;
  }[];
  totales: { totalCuotas: number; totalMora: number; totalAhorro: number; totalOfrecido: number };
  /** Fila enfocada: la que alimenta la vista previa del mensaje. */
  focoId: string | null;
  onFoco: (id: string) => void;
  /** Recordatorio de vencimiento: no hay atraso ni punitorios que mostrar. */
  esRecordatorio?: boolean;
  /**
   * Invitación a refinanciar: no hay descuento (la quita de la campaña se aplica al cobrar y
   * a estos no se les cobra), y la última columna es lo que deben HOY —no lo que se les pide,
   * porque no se les pide nada: se los invita a reestructurar.
   */
  esRefinanciacion?: boolean;
  /**
   * Oferta de recupero: las columnas son OTRAS, no las mismas con otro rótulo. No hay cuotas
   * vencidas ni punitorios que discriminar —la deuda de un castigado se negocia entera— y sí
   * hace falta ver hace cuánto está castigado y cuánto se resigna. Por eso va su propia tabla
   * en vez de una quinta tanda de condicionales sobre la de mora.
   */
  esRecupero?: boolean;
}) {
  const th = "px-4 py-2.5 text-left text-[11px] font-bold uppercase tracking-wider text-muted-foreground";
  const thNum = `${th} text-right`;
  const td = "px-4 py-3 text-sm";
  const tdNum = `${td} text-right font-mono tabular-nums`;

  if (esRecupero) {
    return (
      <table className="w-full border-separate border-spacing-0">
        <thead className="sticky top-0 z-10 bg-muted">
          <tr>
            <th className={`${th} border-b border-border`}>Cliente</th>
            <th className={`${th} border-b border-border`}>Castigado</th>
            <th className={`${thNum} border-b border-border`}>Se le reclama</th>
            <th className={`${thNum} border-b border-border`}>Capital en riesgo</th>
            <th className={`${thNum} border-b border-border`}>Se condona</th>
            <th className={`${thNum} border-b border-border`}>Se le ofrece</th>
          </tr>
        </thead>
        <tbody>
          {objetivos.map((o, i) => {
            const enFoco = o.credito.id === focoId;
            const r = o.recupero;
            return (
              <tr
                key={o.credito.id}
                role="button"
                tabIndex={0}
                aria-pressed={enFoco}
                onClick={() => onFoco(o.credito.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onFoco(o.credito.id); }
                }}
                className={`cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/50 ${
                  enFoco ? "bg-primary/10" : `hover:bg-muted/20 ${i % 2 === 1 ? "bg-muted/5" : ""}`
                }`}
              >
                <td className={`${td} min-w-0 relative`}>
                  {enFoco && <span className="absolute inset-y-1 left-0 w-0.5 rounded-r bg-primary" />}
                  <p className="truncate font-medium text-foreground">{nombreCompleto(o.credito.cliente)}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {o.credito.numero ? `CRD-${String(o.credito.numero).padStart(6, "0")}` : "Crédito sin número"}
                    {(o.credito.cobrado_post_castigo ?? 0) > 0 && (
                      <span className="text-success"> · pagó ya castigado</span>
                    )}
                  </p>
                </td>
                <td className={`${td} whitespace-nowrap text-muted-foreground`}>
                  {o.credito.incobrable_at ? formatFecha(o.credito.incobrable_at) : "—"}
                </td>
                {/* La deuda nominal va en gris y sin protagonismo: es el número que NO se le
                    dice al cliente, y está acá solo para dimensionar lo que se resigna. */}
                <td className={`${tdNum} text-muted-foreground`}>{formatMonto(r?.deuda ?? 0)}</td>
                <td className={`${tdNum} font-semibold text-destructive`}>{formatMonto(r?.riesgo ?? 0)}</td>
                <td className={`${tdNum} text-warning`}>{formatMonto(r?.condona ?? 0)}</td>
                <td className={`${tdNum} font-bold text-success`}>{formatMonto(r?.monto ?? 0)}</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot className="sticky bottom-0 z-10 bg-card">
          <tr>
            <td className={`${td} border-t border-border font-semibold text-foreground`} colSpan={2}>
              Total de la campaña
            </td>
            <td className={`${tdNum} border-t border-border text-muted-foreground`}>{formatMonto(totales.totalCuotas)}</td>
            <td className={`${tdNum} border-t border-border font-semibold text-destructive`}>
              {formatMonto(objetivos.reduce((s, o) => s + (o.recupero?.riesgo ?? 0), 0))}
            </td>
            <td className={`${tdNum} border-t border-border text-warning`}>{formatMonto(totales.totalAhorro)}</td>
            <td className={`${tdNum} border-t border-border font-bold text-success`}>{formatMonto(totales.totalOfrecido)}</td>
          </tr>
        </tfoot>
      </table>
    );
  }

  return (
    <table className="w-full border-separate border-spacing-0">
      <thead className="sticky top-0 z-10 bg-muted">
        <tr>
          {/*
            Los rótulos cambian con el tipo: en un recordatorio no hay atraso ni punitorios, y
            dejar las columnas con esos nombres en cero le haría creer al operador que el
            cálculo falló. Las que no aplican no se muestran vacías: no se muestran.
          */}
          <th className={`${th} border-b border-border`}>Cliente</th>
          <th className={`${th} border-b border-border`}>{esRecordatorio ? "Vence" : "Atraso"}</th>
          <th className={`${thNum} border-b border-border`}>{esRecordatorio ? "Cuota" : "Cuotas vencidas"}</th>
          {!esRecordatorio && <th className={`${thNum} border-b border-border`}>Punitorios</th>}
          {!esRecordatorio && !esRefinanciacion && <th className={`${thNum} border-b border-border`}>Descuento</th>}
          <th className={`${thNum} border-b border-border`}>
            {esRecordatorio ? "Se le recuerda" : esRefinanciacion ? "Vencido hoy" : "Se le pide"}
          </th>
        </tr>
      </thead>
      <tbody>
        {objetivos.map((o, i) => {
          const enFoco = o.credito.id === focoId;
          return (
          /* Clickeable: cada mensaje lleva el importe del cliente adentro, así que la vista
             previa tiene que poder seguir a la fila. Operable por teclado (contrato de diseño). */
          <tr
            key={o.credito.id}
            role="button"
            tabIndex={0}
            aria-pressed={enFoco}
            onClick={() => onFoco(o.credito.id)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onFoco(o.credito.id); }
            }}
            className={`cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/50 ${
              enFoco ? "bg-primary/10" : `hover:bg-muted/20 ${i % 2 === 1 ? "bg-muted/5" : ""}`
            }`}
          >
            <td className={`${td} min-w-0 relative`}>
              {/* Barra de acento: el fondo solo no alcanza para señalar cuál está alimentando
                  la vista previa cuando la lista es larga. */}
              {enFoco && <span className="absolute inset-y-1 left-0 w-0.5 rounded-r bg-primary" />}
              <p className="truncate font-medium text-foreground">{nombreCompleto(o.credito.cliente)}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {o.credito.numero ? `CRD-${String(o.credito.numero).padStart(6, "0")}` : "Crédito sin número"}
                {" · "}
                {/*
                  🔴 "al día" SALE DEL CRÉDITO, no del modo de la pantalla. Era un literal:
                  en modo recordatorio la fila lo escribía siempre, así que un moroso de 28
                  días figuraba como al día. Ahora, si la fila trae atraso, lo dice — aunque
                  la campaña se haya armado como recordatorio.
                */}
                {esRecordatorio && o.credito.dias_mora <= 0
                  ? "al día"
                  : o.credito.cuotas_vencidas
                  ? `${o.credito.cuotas_vencidas} ${o.credito.cuotas_vencidas === 1 ? "cuota impaga" : "cuotas impagas"}`
                  : "sin cuotas vencidas"}
              </p>
            </td>
            <td className={`${td} whitespace-nowrap text-muted-foreground`}>
              {/* Lo mismo con la fecha: "vence el 10/08/2026" sobre algo que venció hace 28
                  días es el mismo error escrito de otra forma. */}
              {esRecordatorio && o.credito.dias_mora <= 0
                ? formatFecha(o.credito.proximo_pago)
                : formatDias(o.credito.dias_mora)}
            </td>
            <td className={`${tdNum} text-foreground`}>{formatMonto(o.vencidoSinMora)}</td>
            {!esRecordatorio && (
              <td className={`${tdNum} ${o.mora > 0 ? "text-warning" : "text-muted-foreground"}`}>{formatMonto(o.mora)}</td>
            )}
            {!esRecordatorio && !esRefinanciacion && (
              <td className={`${tdNum} ${o.oferta.ahorro > 0 ? "text-success" : "text-muted-foreground"}`}>
                {o.oferta.ahorro > 0 ? `− ${formatMonto(o.oferta.ahorro)}` : formatMonto(0)}
              </td>
            )}
            <td className={`${tdNum} font-bold text-foreground`}>{formatMonto(o.oferta.montoConDescuento)}</td>
          </tr>
          );
        })}
      </tbody>
      <tfoot className="sticky bottom-0 z-10 bg-card">
        <tr>
          <td className={`${td} border-t border-border font-semibold text-foreground`} colSpan={2}>
            Total de la campaña
          </td>
          {/* 🔴 Las mismas columnas que el thead. Un pie con más celdas que encabezados corre
              los totales bajo la columna equivocada — ya pasó una vez en Créditos. */}
          <td className={`${tdNum} border-t border-border text-foreground`}>{formatMonto(totales.totalCuotas)}</td>
          {!esRecordatorio && (
            <td className={`${tdNum} border-t border-border text-warning`}>{formatMonto(totales.totalMora)}</td>
          )}
          {!esRecordatorio && !esRefinanciacion && (
            <td className={`${tdNum} border-t border-border text-success`}>
              {totales.totalAhorro > 0 ? `− ${formatMonto(totales.totalAhorro)}` : formatMonto(0)}
            </td>
          )}
          <td className={`${tdNum} border-t border-border font-bold text-foreground`}>{formatMonto(totales.totalOfrecido)}</td>
        </tr>
      </tfoot>
    </table>
  );
}
