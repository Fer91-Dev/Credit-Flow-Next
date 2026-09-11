"use client";

import { useRouter } from "next/navigation";
import { ArrowLeft, RefreshCcw } from "lucide-react";
import { CreditoDetail } from "./CreditoDetail";
import { SystemControls } from "@/components/ui/SystemControls";
import { Skeleton } from "@/components/ui/skeleton";
import { useCreditos, useDiasLegales, type Credito } from "@/lib/swr";
import { StatusBadge } from "@/components/ui/StatusBadge";
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
      {/* Encabezado — misma altura (76px) que el PageHeader, el sidebar y Refinanciar. */}
      <div className="sticky top-0 z-30 flex h-[76px] shrink-0 items-center justify-between gap-3 border-b border-edge bg-background/95 px-5 backdrop-blur">
        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            onClick={volver}
            title="Volver a Créditos"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div className="min-w-0">
            {/*
              El numero, el ESTADO y el titular viven SOLO aca.

              El cuerpo del detalle los repetia enteros veinte pixeles mas abajo -- numero en
              24px, badge y nombre -- asi que la pantalla arrancaba diciendo dos veces lo mismo
              y le comia al plan de cuotas el alto que necesita para verse sin scroll.
            */}
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              {/*
                🔴 EN UNA REFINANCIACIÓN EL NÚMERO VA EN ÁMBAR, no en el color del texto.

                El prefijo "REF-" ya lo dice, pero un prefijo se lee y un color se ve: la
                pantalla tiene que anunciar que esto NO es un crédito común antes de que nadie
                lea nada. Es el mismo ámbar del badge "Refinanciado" y de la tarjeta de abajo:
                un solo color para un solo concepto, en toda la pantalla.
              */}
              <h1 className={`truncate font-mono text-base font-semibold leading-tight ${
                credito?.es_refinanciacion ? "text-warning" : "text-foreground"
              }`}>
                {credito ? formatCreditoNumero(credito.numero, credito.refinancia_a_numero) : "Crédito"}
              </h1>
              {credito?.es_refinanciacion && (
                <span
                  className="inline-flex shrink-0 items-center gap-1 rounded-full bg-warning/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-warning ring-1 ring-inset ring-warning/30"
                  title="Este crédito nació de reestructurar otro: su capital es deuda consolidada, no plata prestada"
                >
                  <RefreshCcw className="h-3 w-3" /> Refinanciación
                </span>
              )}
              {credito && <StatusBadge {...estadoBadgeCredito(credito.estado, credito.dias_mora, diasLegales, null, (credito.cobrado_post_castigo ?? 0) > 0)} />}
            </div>
            {/*
              EL CLIENTE NO ES UN SUBTÍTULO. Iba en `text-xs` gris, del mismo peso que
              cualquier pie de página, cuando es la otra mitad de la identidad de esta
              pantalla: el operador tiene a esa persona enfrente o al teléfono. Sube al color
              del texto y a un cuerpo que se lee sin acercarse.
            */}
            <p className="mt-0.5 truncate text-sm font-medium text-foreground">
              {credito ? nombreCompleto(credito.cliente) : "Detalle del crédito"}
            </p>
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
