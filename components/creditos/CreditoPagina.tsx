"use client";

import { useRouter } from "next/navigation";
import { ArrowLeft, RefreshCcw, Handshake } from "lucide-react";
import { CreditoDetail } from "./CreditoDetail";
import { SystemControls } from "@/components/ui/SystemControls";
import { Skeleton } from "@/components/ui/skeleton";
import { useCreditos, useDiasLegales, type Credito } from "@/lib/swr";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Emoji } from "@/components/ui/Emoji";
import { estadoBadgeCredito } from "./estado-badge";
import { formatCreditoNumero, nombreCompleto } from "@/lib/utils";
import { type Role } from "@/lib/auth/roles";

/**
 * EL DETALLE DE UN CRÉDITO, COMO PANTALLA CON DIRECCIÓN PROPIA (`/creditos/[id]`).
 *
 * ── POR QUÉ EXISTE ──
 *
 * El detalle era solo un diálogo de la lista, así que un crédito no tenía a dónde enlazar:
 * cualquier pantalla que lo nombrara —refinanciar, la ficha del cliente, la comparación de
 * una refinanciación, el bloqueo de cobro en la terminal— solo podía escribir el número y
 * dejar al operador ir a Créditos y buscarlo a mano.
 *
 * El primer intento fue `/creditos?credito=<id>`: llevaba a la LISTA y desde ahí abría el
 * diálogo. Se veía el rebote —aterrizás en una tabla que no pediste y un instante después te
 * salta un modal encima— y con la lista fría había que esperar a que cargaran los mil
 * créditos antes de que apareciera nada. Un link tiene que llevar a lo que dice, no a otra
 * pantalla que después te lleva.
 *
 * ── DE DÓNDE SALEN LOS DATOS ──
 *
 * De la MISMA lista que alimenta el diálogo (`useCreditos`), y no de `GET /creditos/[id]`.
 * No es pereza: el detalle usa un montón de campos DERIVADOS —la mora en vivo, lo vencido,
 * las cuotas vencidas, si el cobro está bloqueado, el acuerdo vigente— que hoy los calcula
 * el endpoint de la lista. Pedirlos por el del id obligaría a duplicar esos cálculos en dos
 * rutas, que es exactamente cómo se desincronizan dos números que tienen que ser el mismo.
 *
 * El costo es una consulta que SWR casi siempre tiene en caché (la piden Créditos, Cobranza
 * y el Dashboard); en una pestaña nueva se paga una vez.
 */
export function CreditoPagina({ id, role }: { id: string; role?: Role }) {
  const router = useRouter();
  const { creditos, isLoading, error, mutate } = useCreditos();
  /** A cuántos días de atraso pasa a Legales (Configuración). Lo necesita el badge. */
  const diasLegales = useDiasLegales();
  const credito = creditos.find((c) => c.id === id) ?? null;
  /**
   * 🔴 EL ACUERDO DE PAGO VIGENTE, QUE ESTA PANTALLA IGNORABA.
   *
   * `estadoBadgeCredito` recibe la situación del acuerdo desde 2026-08 y sabe contestar
   * "En acuerdo" (verde) o "Acuerdo atrasado" (rojo). La lista de Créditos se la pasa; acá
   * iba `null` fijo. Resultado: la fila de la lista decía "En acuerdo" y, al hacerle clic,
   * la pantalla del mismo crédito decía "Legales" — dos veredictos distintos sobre la misma
   * persona, a un clic de distancia.
   *
   * `credito.acuerdo` solo viene cuando el acuerdo está VIGENTE (lo filtra
   * `situacionAcuerdoPorCredito`), y su `al_dia` lo resuelve el server contra el día
   * argentino: después de las 21:00 el navegador daría por incumplida una cuota que vence hoy.
   */
  const acuerdo = credito?.acuerdo ?? null;

  const volver = () => router.push("/creditos");
  const irA = (c: Credito) => router.push(`/creditos/${c.id}`);

  return (
    /*
      🔴 LA PÁGINA CRECE; NO ES UNA VENTANA DE ALTO FIJO.

      Era `h-[calc(100dvh-3rem)]` con el cuerpo en `overflow-y-auto`: los KPI arriba y la barra
      de acciones abajo quedaban clavados, y todo lo del medio —el plan de cuotas, que es la
      razón de esta pantalla— vivía en una ventanita de unos 300px. Por eso la tabla "se
      escondía dentro del scroll" por más que se le sacara el suyo propio: no era la tabla, era
      el contenedor.

      Ahora la página fluye como un documento y scrollea el navegador. El encabezado se queda
      `sticky` —con el número, el cliente y el estado— porque es la identidad de lo que se
      está mirando y perderla al bajar es lo único que el alto fijo resolvía bien.
    */
    <div className="-mx-4 -mb-6 md:-mx-6 md:-mb-8 lg:-mx-8 flex min-h-[calc(100dvh-3rem)] flex-col bg-background">
      {/*
        Encabezado — misma altura (76px) que el PageHeader, el sidebar y Refinanciar.

        REDISEÑO (Fernando, 02/10/2026: "dale un mejor aspecto y que se vea el nombre del
        cliente y su DNI"). El operador tiene a esa persona enfrente o al teléfono, y lo primero
        que pide para identificarla es el DNI: va en el renglón de arriba, junto al nombre. El
        número del crédito y sus estados bajan a un renglón de chips. El ícono dice qué clase
        de crédito es antes de leer nada (refinanciación, acuerdo, común).
      */}
      <div className="sticky top-0 z-30 flex min-h-[76px] shrink-0 items-center justify-between gap-3 border-b border-edge bg-background/95 px-5 py-2.5 backdrop-blur lg:h-[76px] lg:py-0">
        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            onClick={volver}
            title="Volver a Créditos"
            aria-label="Volver a Créditos"
            className="group flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border bg-card/60 text-muted-foreground transition-colors hover:border-primary/40 hover:bg-muted/40 hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4 transition-transform duration-200 group-hover:-translate-x-0.5" />
          </button>
          <div
            className={`hidden h-10 w-10 shrink-0 items-center justify-center rounded-xl border sm:flex ${
              credito?.es_refinanciacion
                ? "border-warning/30 bg-warning/10"
                : acuerdo
                  ? "border-primary/30 bg-primary/10"
                  : "border-border/60 bg-muted/40"
            }`}
          >
            <Emoji
              name={credito?.es_refinanciacion ? "counterclockwise-arrows-button" : acuerdo ? "handshake" : "credit-card"}
              className="h-6 w-6"
            />
          </div>
          <div className="min-w-0">
            {/*
              El numero, el ESTADO y el titular viven SOLO aca: el cuerpo del detalle no los
              repite (le comia al plan de cuotas el alto que necesita).
            */}
            <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-0.5">
              <h1 className="truncate text-base font-semibold leading-tight tracking-tight text-foreground sm:text-lg">
                {credito ? nombreCompleto(credito.cliente) : "Detalle del crédito"}
              </h1>
              {credito?.cliente.documento && (
                <span className="flex shrink-0 items-baseline gap-1.5">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-primary/70">DNI</span>
                  <span className="font-mono text-sm font-semibold tabular-nums text-foreground">
                    {formatDni(credito.cliente.documento)}
                  </span>
                </span>
              )}
            </div>
            <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1.5">
              {/*
                🔴 EN UNA REFINANCIACIÓN EL NÚMERO VA EN ÁMBAR: el prefijo "REF-" se lee, el
                color se ve. Mismo ámbar del badge "Refinanciado" y de la tarjeta de abajo.
              */}
              <span className={`shrink-0 rounded-md px-1.5 py-0.5 font-mono text-xs font-bold tracking-wide ring-1 ring-inset ${
                credito?.es_refinanciacion
                  ? "bg-warning/10 text-warning ring-warning/30"
                  : "bg-muted text-foreground ring-border"
              }`}>
                {credito ? formatCreditoNumero(credito.numero, credito.refinancia_a_numero) : "Crédito"}
              </span>
              {credito?.es_refinanciacion && (
                <span
                  className="inline-flex shrink-0 items-center gap-1 rounded-full bg-warning/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-warning ring-1 ring-inset ring-warning/30"
                  title="Este crédito nació de reestructurar otro: su capital es deuda consolidada, no plata prestada"
                >
                  <RefreshCcw className="h-3 w-3" /> Refinanciación
                </span>
              )}
              {/*
                EL CHIP DEL ACUERDO VA ANTES QUE EL BADGE, y no lo reemplaza: el badge dice en
                qué ESTADO está el crédito; el chip, que hay un contrato nuevo de por medio.
                Ámbar = ORIGEN (nació de refinanciar), índigo = SITUACIÓN de hoy (acuerdo).
              */}
              {acuerdo && (
                <span
                  className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ring-1 ring-inset ${
                    acuerdo.al_dia
                      ? "bg-primary/15 text-primary ring-primary/30"
                      : "bg-destructive/15 text-destructive ring-destructive/30"
                  }`}
                  title={
                    acuerdo.al_dia
                      ? "Tiene un acuerdo de pago vigente y lo est\u00e1 cumpliendo: lo que se cobra es la cuota pactada, no la del plan original"
                      : "Tiene un acuerdo de pago vigente con cuotas pactadas vencidas"
                  }
                >
                  <Handshake className="h-3 w-3" /> Acuerdo de pago
                </span>
              )}
              {credito && <StatusBadge {...estadoBadgeCredito(credito.estado, credito.dias_mora, diasLegales, acuerdo ? { alDia: acuerdo.al_dia } : null, (credito.cobrado_post_castigo ?? 0) > 0)} />}
            </div>
          </div>
        </div>
        <SystemControls />
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        {isLoading ? (
          <div className="space-y-3 p-6">
            <Skeleton className="h-24 rounded-xl" />
            <Skeleton className="h-64 rounded-xl" />
          </div>
        ) : credito ? (
          <CreditoDetail
            credito={credito}
            role={role}
            onRefinanciar={(c) => router.push(`/creditos/${c.id}/refinanciar`)}
            // Los dos extremos de una refinanciación: saltar de uno al otro cambia la URL,
            // así que el botón de atrás del navegador deshace el salto.
            onAbrirCredito={irA}
            /**
             * Anular o eliminar deja esta pantalla mostrando algo que ya no existe (o que
             * cambió de estado), así que se vuelve a la lista. En el diálogo alcanzaba con
             * cerrarlo; acá el equivalente es salir.
             */
            onCerrar={() => { mutate(); volver(); }}
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
            <p className="text-sm font-medium text-foreground">
              {error ? "No se pudo cargar el crédito." : "Este crédito no existe o no está a tu alcance."}
            </p>
            <p className="max-w-sm text-xs text-muted-foreground">
              {error
                ? "Probá de nuevo en un momento."
                : "Puede haberse eliminado, o pertenecer a otro agente."}
            </p>
            <button
              onClick={volver}
              className="mt-1 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
            >
              Ir a Créditos
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/** DNI con puntos de miles ("30.123.456"), como figura en el documento. Si no es solo dígitos, tal cual. */
function formatDni(doc: string): string {
  const d = doc.replace(/\D/g, "");
  return d.length >= 6 && d.length <= 9 && d === doc.replace(/[.\s]/g, "") ? Number(d).toLocaleString("es-AR") : doc;
}
