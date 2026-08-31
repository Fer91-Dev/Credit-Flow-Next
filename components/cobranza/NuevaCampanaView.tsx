"use client";

import { Fragment, useEffect, useMemo, useState, type ComponentType } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { mutate as globalMutate } from "swr";
import { ArrowLeft, Mail, Smartphone, Sparkles, Check, Loader2, Users } from "lucide-react";
import { WhatsAppIcon } from "@/components/ui/WhatsAppIcon";
import { useCreditos, useConfiguracion, useFinanciera, KEYS, type Credito } from "@/lib/swr";
import {
  calculateRecoveryOffer,
  construirMensajeCampana,
  linkWhatsapp,
  TEMPLATE_DEFAULT,
  plantillaMetaParaCampana,
  riesgoEnvioMeta,
  CATEGORIA_META_LABEL,
  contactoBloqueado,
  type CanalCampana,
} from "@/lib/domain";
import { AvisoMeta } from "@/components/clientes/ContactarDialog";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { SystemControls } from "@/components/ui/SystemControls";
import { Emoji } from "@/components/ui/Emoji";
import { Skeleton } from "@/components/ui/skeleton";
import { nombreCompleto, formatMonto, formatDias } from "@/lib/utils";
import { useConfirm } from "@/components/ui/confirm";
import { useToast } from "@/components/ui/toast";
import { type Role } from "@/lib/auth/roles";
import { leerSeleccionCampana, limpiarSeleccionCampana } from "./seleccion-campana";

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
              Reclamo masivo a los créditos en mora seleccionados
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
            onTerminar={() => {
              limpiarSeleccionCampana();
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
  onTerminar: () => void;
}

function CampanaWorkspace({ role, creditos, bloqueados, onCancelar, onTerminar }: WorkspaceProps) {
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

  const [form, setForm] = useState({
    nombre: "",
    descripcion: "",
    canal: "whatsapp" as CanalCampana,
    promoActiva: true,
    promo_valor: "50",
    promo_vence: "",
    mensaje_template: TEMPLATE_DEFAULT,
    /** Nombre de la plantilla de Meta elegida ("" = texto libre). */
    plantilla_meta: "",
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

  const descuentoPct = form.promoActiva ? Math.min(100, Math.max(0, parseFloat(form.promo_valor) || 0)) : 0;

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
  const excedeTope = topeConocido && form.promoActiva && descuentoPct > topeDescuento;

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
        const mora = c.interes_mora ?? 0;
        const vencidoSinMora = Math.max(0, (c.vencido ?? 0) - mora);
        const oferta = calculateRecoveryOffer({
          saldo: vencidoSinMora,
          interesMora: mora,
          diasMora: c.dias_mora,
          descuentoPct,
        });
        return { credito: c, oferta, vencidoSinMora, mora };
      }),
    [creditos, descuentoPct],
  );

  const totalCuotas = objetivos.reduce((s, o) => s + o.vencidoSinMora, 0);
  const totalMora = objetivos.reduce((s, o) => s + o.mora, 0);
  const totalAhorro = objetivos.reduce((s, o) => s + o.oferta.ahorro, 0);
  const totalOfrecido = objetivos.reduce((s, o) => s + o.oferta.montoConDescuento, 0);
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
      monto: o.oferta.montoConDescuento,
      saldo: o.credito.saldo_pendiente,
      dias: o.credito.dias_mora,
      descuento: o.oferta.ahorro,
    });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.nombre.trim()) {
      setError("Poné un nombre a la campaña");
      return;
    }
    // Redundante con el `disabled` del botón y con el 403 del servidor, a propósito: es el
    // único de los tres que explica el motivo si alguien llega igual (Enter en un campo).
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
      description: `Se creará la campaña "${form.nombre.trim()}" con ${creditos.length} crédito${creditos.length !== 1 ? "s" : ""} en mora por ${CANAL_META[form.canal].label}.`,
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
        promo_tipo: form.promoActiva ? "quita_interes" : "ninguna",
        promo_valor: descuentoPct,
        promo_vence: form.promo_vence || undefined,
        mensaje_template: form.mensaje_template.trim() || undefined,
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
        onTerminar();
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
            onClick={onTerminar}
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
            <section className="space-y-2.5">
              <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Incentivo</p>
              <div className={`space-y-3 rounded-lg border p-3 transition-colors ${form.promoActiva ? "border-success/30 bg-success/5" : "border-border"}`}>
                <label className="flex cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    checked={form.promoActiva}
                    onChange={(e) => setForm((p) => ({ ...p, promoActiva: e.target.checked }))}
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
                      <Field label="Válida hasta" hint="Plazo para acogerse">
                        <Input type="date" value={form.promo_vence} onChange={set("promo_vence")} />
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

          <div className="md:min-h-0 md:flex-1 overflow-auto">
            <TablaAudiencia
              objetivos={objetivos}
              totales={{ totalCuotas, totalMora, totalAhorro, totalOfrecido }}
              focoId={objetivoFoco?.credito.id ?? null}
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
            disabled={loading || excedeTope}
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
  cuotas, punitorios, descuento, total, reducir,
}: {
  cuotas: number; punitorios: number; descuento: number; total: number; reducir: boolean;
}) {
  const etapas = [
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
}: {
  objetivos: {
    credito: Credito;
    oferta: { montoConDescuento: number; ahorro: number };
    vencidoSinMora: number;
    mora: number;
  }[];
  totales: { totalCuotas: number; totalMora: number; totalAhorro: number; totalOfrecido: number };
  /** Fila enfocada: la que alimenta la vista previa del mensaje. */
  focoId: string | null;
  onFoco: (id: string) => void;
}) {
  const th = "px-4 py-2.5 text-left text-[11px] font-bold uppercase tracking-wider text-muted-foreground";
  const thNum = `${th} text-right`;
  const td = "px-4 py-3 text-sm";
  const tdNum = `${td} text-right font-mono tabular-nums`;

  return (
    <table className="w-full border-separate border-spacing-0">
      <thead className="sticky top-0 z-10 bg-muted">
        <tr>
          <th className={`${th} border-b border-border`}>Cliente</th>
          <th className={`${th} border-b border-border`}>Atraso</th>
          <th className={`${thNum} border-b border-border`}>Cuotas vencidas</th>
          <th className={`${thNum} border-b border-border`}>Punitorios</th>
          <th className={`${thNum} border-b border-border`}>Descuento</th>
          <th className={`${thNum} border-b border-border`}>Se le pide</th>
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
                {o.credito.cuotas_vencidas
                  ? `${o.credito.cuotas_vencidas} ${o.credito.cuotas_vencidas === 1 ? "cuota impaga" : "cuotas impagas"}`
                  : "sin cuotas vencidas"}
              </p>
            </td>
            <td className={`${td} whitespace-nowrap text-muted-foreground`}>{formatDias(o.credito.dias_mora)}</td>
            <td className={`${tdNum} text-foreground`}>{formatMonto(o.vencidoSinMora)}</td>
            <td className={`${tdNum} ${o.mora > 0 ? "text-warning" : "text-muted-foreground"}`}>{formatMonto(o.mora)}</td>
            <td className={`${tdNum} ${o.oferta.ahorro > 0 ? "text-success" : "text-muted-foreground"}`}>
              {o.oferta.ahorro > 0 ? `− ${formatMonto(o.oferta.ahorro)}` : formatMonto(0)}
            </td>
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
          <td className={`${tdNum} border-t border-border text-foreground`}>{formatMonto(totales.totalCuotas)}</td>
          <td className={`${tdNum} border-t border-border text-warning`}>{formatMonto(totales.totalMora)}</td>
          <td className={`${tdNum} border-t border-border text-success`}>
            {totales.totalAhorro > 0 ? `− ${formatMonto(totales.totalAhorro)}` : formatMonto(0)}
          </td>
          <td className={`${tdNum} border-t border-border font-bold text-foreground`}>{formatMonto(totales.totalOfrecido)}</td>
        </tr>
      </tfoot>
    </table>
  );
}
