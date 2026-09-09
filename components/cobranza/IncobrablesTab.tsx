"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Download, Megaphone, HandCoins, Phone } from "lucide-react";
import { DataTable } from "@/components/ui/DataTable";
import { KpiCard } from "@/components/ui/KpiCard";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Skeleton } from "@/components/ui/skeleton";
import { BuscadorF3 } from "@/components/ui/BuscadorF3";
import { CreditoLink } from "@/components/ui/CreditoLink";
import { useToast } from "@/components/ui/toast";
import { useCreditos, useOfertaRecupero } from "@/lib/swr";
import { CerrarCasoDialog } from "./CerrarCasoDialog";
import { GestionCasoDialog } from "./GestionCasoDialog";
import { guardarSeleccionCampana, guardarTipoCampana } from "./seleccion-campana";
import { descargarCSV } from "@/lib/csv";
import { contactoBloqueado, normalizarTelefonoAR, sugerirOfertaCancelacion } from "@/lib/domain";
import { formatMonto, formatFecha, formatDias, nombreCompleto, hoyComercial } from "@/lib/utils";

/**
 * INCOBRABLES — la cartera castigada, y cómo se trabaja.
 *
 * ── POR QUÉ ES UNA PESTAÑA APARTE Y NO UN FILTRO DE MOROSOS ──
 *
 * No es la misma cobranza. En Morosos el objetivo es que el cliente se ponga al día: hay un
 * plan vivo, cuotas que vencen y punitorios que corren, y el mensaje reclama lo exigible. Acá
 * el plan ya no existe: la deuda se dio por perdida, los punitorios están frenados y el
 * objetivo es OTRO — recuperar algo, negociando. Mezclarlos haría que la lista de morosos
 * fuera el archivo de todos los casos perdidos desde el principio, que es exactamente lo que
 * el estado incobrable vino a resolver.
 *
 * ── EL NÚMERO CONTRA EL QUE SE NEGOCIA NO ES LA DEUDA ──
 *
 * Este es el punto donde una pantalla de recupero se distingue de una lista de deudores. La
 * deuda que se reclama es NOMINAL: capital, más el interés que se capitalizó al refinanciar,
 * más los punitorios acumulados. Sobre CRD-000019 son $2.326.775,16 — un número que no dice
 * nada sobre si la financiera gana o pierde, porque está inflado por su propio interés.
 *
 * Lo que sí lo dice: se prestaron $880.000,00 y volvieron $0,00. Ese es el CAPITAL EN RIESGO,
 * y es el piso de cualquier negociación. Cobrar $500.000,00 no es "aceptar el 21% de la
 * deuda": es recuperar más de la mitad de la plata que salió de la caja. Sin ese dato el
 * operador negocia contra un número inflado y termina regalando el caso o perdiéndolo.
 *
 * Por eso las dos columnas van juntas y el capital en riesgo va destacado.
 *
 * ── EL ORDEN NO ES POR DEUDA NI POR ATRASO ──
 *
 * En cartera castigada la probabilidad de recupero cae con la antigüedad, y lo que conviene
 * trabajar primero es plata recuperable × probabilidad. La lista ordena por capital en riesgo
 * dentro de los castigados RECIENTES, no por la deuda más grande: la deuda más grande suele
 * ser la más vieja, o sea la que menos chance tiene.
 *
 * Y los que PAGARON ALGO después del castigo van marcados: demostraron voluntad de pago y son
 * los mejores candidatos de toda la lista.
 */
export function IncobrablesTab() {
  const router = useRouter();
  const toast = useToast();
  const { creditos, isLoading, mutate } = useCreditos();
  /** Con qué criterio sugerir la cancelación. Lo fija la financiera en Configuración. */
  const cfgOferta = useOfertaRecupero();
  const [q, setQ] = useState("");
  /** Caso que se está cerrando (`null` = ninguno). */
  const [cerrando, setCerrando] = useState<string | null>(null);
  /** Caso que se está gestionando: llamarlo, anotar qué contestó, ver qué se hizo antes. */
  const [gestionando, setGestionando] = useState<string | null>(null);

  const hoy = hoyComercial();

  const filas = useMemo(() => {
    const texto = q.trim().toLowerCase();
    return creditos
      .filter((c) => c.estado === "incobrable")
      .filter((c) => {
        if (!texto) return true;
        const nom = nombreCompleto(c.cliente).toLowerCase();
        return nom.includes(texto) || (c.cliente?.documento ?? "").includes(texto);
      })
      .map((c) => {
        const desde = c.incobrable_at ? new Date(c.incobrable_at) : null;
        const diasCastigado = desde ? Math.max(0, Math.floor((hoy.getTime() - desde.getTime()) / 86_400_000)) : 0;
        /**
         * Lo prestado y lo recuperado salen del SERVER (`plataDeLaCadenaLote`), que recorre
         * la cadena de refinanciaciones. Esta pantalla lo hacía por su cuenta en el navegador
         * porque el `capital_en_riesgo` del endpoint estaba mal para los refinanciados; ya no:
         * la cuenta que decide cuánta plata se resigna vive en un solo lado, y la campaña de
         * recupero y el cierre del caso usan exactamente la misma.
         */
        const prestado = c.prestado_cadena ?? c.monto_original;
        const cobrado = c.recuperado_cadena ?? c.cobrado ?? 0;
        const riesgo = c.capital_en_riesgo ?? Math.round(Math.max(0, prestado - cobrado) * 100) / 100;
        /**
         * El número que el operador va a decir por teléfono. Sale del motor, no del ojo: a
         * ojo se acepta de menos cuando el caso era bueno y se planta de más cuando ya no da,
         * y ahí se termina cobrando cero.
         */
        const oferta = sugerirOfertaCancelacion(
          {
            capitalEnRiesgo: riesgo,
            deudaReclamada: c.vencido || c.saldo_pendiente,
            diasCastigado,
            // Pagó DESPUÉS del castigo, con la fecha del pago contra la del castigo. No es
            // "tiene algún cobro": el que pagó tres cuotas y después desapareció no es el que
            // apareció a pagar cuando ya nadie le reclamaba, y son ofertas distintas.
            pagoPostCastigo: (c.cobrado_post_castigo ?? 0) > 0,
          },
          cfgOferta,
        );
        return { c, diasCastigado, prestado, cobrado, riesgo, oferta };
      })
      /**
       * Primero lo que más plata puede devolver y hace menos que se castigó. La antigüedad
       * entra como divisor y no como filtro: un caso viejo con mucho capital sigue valiendo
       * más que uno reciente por dos pesos, pero pierde lugar contra uno de ayer parecido.
       */
      .sort((a, b) => b.riesgo / (1 + b.diasCastigado / 90) - a.riesgo / (1 + a.diasCastigado / 90));
  }, [creditos, q, hoy]);

  const kpis = useMemo(() => {
    const prestado = filas.reduce((s, f) => s + f.prestado, 0);
    const recuperado = filas.reduce((s, f) => s + f.cobrado, 0);
    return {
      casos: filas.length,
      prestado,
      recuperado,
      riesgo: filas.reduce((s, f) => s + f.riesgo, 0),
      // Los que pagaron algo DESPUÉS de darse por perdidos: la mejor señal de la lista.
      conSenal: filas.filter((f) => (f.c.cobrado_post_castigo ?? 0) > 0).length,
    };
  }, [filas]);

  const contactables = filas.filter((f) => !contactoBloqueado(f.c.cliente).bloqueado);

  const exportar = () => {
    if (filas.length === 0) return;
    const num = (x: number) => new Intl.NumberFormat("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(x);
    /**
     * Este archivo se le pasa a un estudio o a una agencia externa, así que lleva lo que hace
     * falta para negociar y nada más: a quién, cómo ubicarlo, cuánto se le reclama, cuánto se
     * puso de verdad y cuánto hace que está castigado. Sin el capital en riesgo, el que llama
     * de afuera negocia contra el número nominal y acepta cualquier cosa o no cierra nunca.
     */
    descargarCSV(`incobrables_${new Date().toISOString().slice(0, 10)}.csv`, [
      ["DNI", "Nombre", "Celular", "Credito", "Deuda reclamada", "Capital prestado", "Ya recuperado", "Capital en riesgo", "Ofrecerle", "% de la perdida", "Castigado el", "Dias castigado", "Motivo"],
      ...filas.map(({ c, diasCastigado, riesgo, cobrado, prestado, oferta }) => [
        c.cliente?.documento ?? "",
        nombreCompleto(c.cliente),
        normalizarTelefonoAR(c.cliente?.telefono) ?? "",
        c.numero ? `REF-${String(c.refinancia_a_numero ?? c.numero).padStart(6, "0")}` : "",
        num(c.vencido ?? c.saldo_pendiente),
        num(prestado),
        num(cobrado),
        num(riesgo),
        oferta ? num(oferta.monto) : "",
        oferta ? oferta.pctDelRiesgo : "",
        c.incobrable_at ? formatFecha(c.incobrable_at) : "",
        diasCastigado,
        c.incobrable_motivo ?? "",
      ]),
    ]);
    toast.success(`${filas.length} caso${filas.length === 1 ? "" : "s"} exportado${filas.length === 1 ? "" : "s"}`);
  };

  if (isLoading) {
    return <div className="space-y-3"><Skeleton className="h-24 rounded-xl" /><Skeleton className="h-64 rounded-xl" /></div>;
  }

  if (creditos.filter((c) => c.estado === "incobrable").length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-border py-16 text-center">
        <p className="text-sm font-medium text-foreground">Todavía no hay cartera castigada.</p>
        <p className="max-w-md text-xs leading-relaxed text-muted-foreground">
          Acá caen las deudas que se dieron por perdidas en el circuito normal: una
          refinanciación que también se atrasó, o un crédito que un administrador dio de baja a
          mano. Salen de la cartera, de la lista de morosos y de la agenda, y los punitorios se
          frenan — pero siguen siendo reclamables y se les puede cobrar. Esta pantalla dice
          cuánto conviene ofrecerle a cada uno para cerrar el caso.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/*
        Los cuatro números que definen la cartera castigada. "Prestado" y "Recuperado" van
        juntos a propósito: la única forma de saber cómo viene el recupero es compararlos, y
        el porcentaje es la métrica de la que se cuelga todo lo demás.
      */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard
          icon="cross-mark"
          label="Casos"
          value={String(kpis.casos)}
          // Los que ya pagaron algo después del castigo son los que hay que trabajar primero:
          // demostraron voluntad de pago, que es lo más escaso en esta cartera.
          sub={kpis.conSenal > 0 ? `${kpis.conSenal} pagaron ya castigados` : undefined}
          accent={kpis.casos > 0 ? "destructive" : "muted"}
        />
        <KpiCard icon="dollar-banknote" label="Capital prestado" value={formatMonto(kpis.prestado)} accent="muted" mono />
        <KpiCard
          icon="money-bag"
          label="Ya recuperado"
          value={formatMonto(kpis.recuperado)}
          sub={kpis.prestado > 0 ? `${((kpis.recuperado / kpis.prestado) * 100).toFixed(1)}% del capital prestado` : undefined}
          accent={kpis.recuperado > 0 ? "success" : "muted"}
          mono
        />
        <KpiCard icon="chart-decreasing" label="Capital en riesgo" value={formatMonto(kpis.riesgo)} accent="destructive" mono />
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <BuscadorF3
          value={q} onChange={setQ} placeholder="Buscar por cliente o DNI…"
          onF3={() => setQ("")} onEscape={() => setQ("")} className="w-full sm:max-w-sm"
        />
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            onClick={exportar}
            title="Descargar la lista para un estudio o una agencia externa"
            className="flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <Download className="h-4 w-4" /> Descargar <span className="font-mono text-xs">{filas.length}</span>
          </button>
          {/*
            La campaña sale sobre los CONTACTABLES, igual que en el resto del SaaS: un
            fallecido o alguien que pidió que no lo contacten queda afuera del conteo, no
            descubierto al final del envío.
          */}
          <button
            type="button"
            onClick={() => {
              /**
               * 🔴 EL BOTÓN NAVEGABA Y NADA MÁS.
               *
               * No escribía ni la selección ni el tipo, así que la pantalla de campaña
               * levantaba lo que hubiera quedado en el `sessionStorage` de una campaña
               * anterior —los sobrantes que se conservan a propósito para no perderlos— y
               * mostraba otros clientes. El contador decía "3" y aparecían tres personas
               * distintas: coincidía el número, no la gente.
               */
              guardarSeleccionCampana(contactables.map((f) => f.c.id));
              guardarTipoCampana("recupero");
              router.push("/cobranza/campanas/nueva");
            }}
            disabled={contactables.length === 0}
            className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            <Megaphone className="h-4 w-4" /> Campaña de recupero
            <span className="rounded bg-primary-foreground/20 px-1.5 py-0.5 text-xs tabular-nums">{contactables.length}</span>
          </button>
        </div>
      </div>

      <DataTable
        rows={filas}
        rowKey={(f) => f.c.id}
        pageSize={12}
        zebra
        empty={{ icon: "magnifying-glass-tilted-left", title: "Sin resultados", hint: "Probá con otro nombre o documento." }}
        columns={[
          {
            header: "Cliente",
            cell: ({ c, cobrado }) => (
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-1.5">
                  <p className="truncate font-medium text-foreground">{nombreCompleto(c.cliente)}</p>
                  {/* Pagó DESPUÉS de darse por perdido: el mejor candidato de la lista, y no
                      se ve en ningún otro número de la fila. No es "tiene algún cobro" — eso
                      lo tiene cualquiera que pagó dos cuotas hace un año. */}
                  {(c.cobrado_post_castigo ?? 0) > 0 && <StatusBadge label="Pagó ya castigado" variant="success" />}
                  {contactoBloqueado(c.cliente).bloqueado && (
                    <StatusBadge label={c.cliente?.no_contactar ? "No contactar" : "Fallecido"} variant="warning" />
                  )}
                </div>
                <CreditoLink id={c.id} numero={c.numero} numeroOrigen={c.refinancia_a_numero} conIcono={false} className="text-[11px]" />
              </div>
            ),
          },
          {
            header: "Contacto",
            cell: ({ c }) => {
              const tel = c.cliente?.telefono, mail = c.cliente?.email;
              if (!tel && !mail) return <span className="text-xs text-destructive">sin contacto</span>;
              return <span className="font-mono text-xs text-muted-foreground">{tel ?? mail}</span>;
            },
          },
          {
            /**
             * 🔴 CUÁNTAS VECES LO PRESTADO, debajo del importe.
             *
             * El importe reclamado solo no se puede explicar mirándolo: sobre Ricardo Paz son
             * $6.745.339,99 —capital consolidado, más el interés del plan de la refinanciación,
             * más los punitorios hasta el castigo— sobre $1.200.000,00 que salieron de la caja.
             * Es exactamente el número que el cliente va a rechazar ("¿cómo me cobran seis
             * millones si me prestaron uno?"), y el operador tiene que verlo venir.
             *
             * El múltiplo es el dato que convierte esa cifra en información: dice de una que
             * la deuda está inflada por su propio interés y cuánto margen real hay para
             * negociar. Sin él, "se le reclama" es una cifra grande sin contexto.
             */
            header: "Se le reclama", align: "right", mono: true,
            cell: ({ c, prestado }) => {
              const reclamado = c.vencido || c.saldo_pendiente;
              const veces = prestado > 0 ? reclamado / prestado : 0;
              return (
                <div className="leading-tight">
                  <span className="text-sm text-muted-foreground">{formatMonto(reclamado)}</span>
                  {veces > 0 && (
                    <span className="block text-[10px] text-warning">
                      {veces.toLocaleString("es-AR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}× lo prestado
                    </span>
                  )}
                </div>
              );
            },
          },
          {
            /**
             * LAS DOS COLUMNAS QUE HACEN LA DIFERENCIA. Arriba lo que salió de la caja, abajo
             * lo que volvió. Juntas dicen si aceptar una oferta es ganancia o pérdida — la
             * deuda de la columna anterior no lo dice, está inflada por su propio interés.
             */
            header: "Prestado / recuperado", align: "right", mono: true,
            cell: ({ cobrado, prestado }) => (
              <div className="leading-tight">
                <span className="text-sm text-foreground">{formatMonto(prestado)}</span>
                <span className={`block text-[10px] ${cobrado > 0 ? "text-success" : "text-muted-foreground"}`}>
                  volvió {formatMonto(cobrado)}
                </span>
              </div>
            ),
          },
          {
            header: <span className="text-destructive">Capital en riesgo</span>, align: "right", mono: true,
            cell: ({ riesgo }) => <span className="font-bold text-destructive">{formatMonto(riesgo)}</span>,
          },
          {
            /**
             * 🔴 EL NÚMERO QUE SE DICE POR TELÉFONO.
             *
             * Es el punto de llegada de toda la fila: con lo prestado, lo que volvió y hace
             * cuánto que está castigado, cuánto conviene pedirle para cerrar. Va con su
             * porcentaje sobre la pérdida, que es lo que hace que se pueda discutir —"le
             * estoy pidiendo el 93% de lo que perdimos" es una frase; "$1.119.960,00" no.
             */
            header: <span className="text-success">Ofrecerle</span>, align: "right", mono: true,
            cell: ({ oferta }) => {
              if (!oferta) return <span className="text-xs text-muted-foreground/50">—</span>;
              return (
                <div className="leading-tight" title={`100% ${oferta.motivos.map((m) => `${m.puntos > 0 ? "+" : ""}${m.puntos}% ${m.texto}`).join(" ")}`}>
                  <span className="font-bold text-success">{formatMonto(oferta.monto)}</span>
                  <span className="block text-[10px] text-muted-foreground">
                    {oferta.pctDelRiesgo}% de la pérdida{oferta.enElPiso ? " · en el piso" : ""}
                  </span>
                </div>
              );
            },
          },
          {
            header: "Castigado", align: "center",
            cell: ({ c, diasCastigado }) => (
              <div className="leading-tight">
                <span className="font-mono text-xs text-foreground">{c.incobrable_at ? formatFecha(c.incobrable_at) : "—"}</span>
                <span className="block text-[10px] text-muted-foreground">hace {formatDias(diasCastigado)}</span>
              </div>
            ),
          },
          {
            /**
             * 🔴 EL BOTÓN QUE FALTABA, y sin el cual toda la fila era decorativa.
             *
             * La columna "Ofrecerle" decía cuánto pedirle, el operador llamaba, el cliente
             * aceptaba... y no había con qué cerrarlo: se le cobraba por la terminal común y
             * el pago se imputaba contra la deuda nominal, dejándolo debiendo el resto y el
             * crédito abierto para siempre. Se le prometía el cierre y el sistema no cerraba.
             */
            header: "", align: "right",
            cell: ({ c }) => (
              <div className="flex items-center justify-end gap-1.5">
                {/* Gestionar va PRIMERO: es lo que se hace muchas veces antes de que haya algo
                    que cerrar. Recuperar cartera vieja es insistir. */}
                <button
                  type="button"
                  onClick={() => setGestionando(c.id)}
                  title="Llamarlo, mandarle la propuesta y anotar qué contestó"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  <Phone className="h-3.5 w-3.5" /> Gestionar
                </button>
                <button
                  type="button"
                  onClick={() => setCerrando(c.id)}
                  title="Cobrar lo pactado, condonar el resto y cerrar el crédito"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-success/30 bg-success/10 px-2.5 py-1.5 text-xs font-semibold text-success transition-colors hover:bg-success/20"
                >
                  <HandCoins className="h-3.5 w-3.5" /> Cerrar
                </button>
              </div>
            ),
          },
        ]}
        renderMobileCard={({ c, cobrado, riesgo, diasCastigado, prestado }) => (
          <div className="space-y-2 rounded-xl border border-border bg-card p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate font-medium text-foreground">{nombreCompleto(c.cliente)}</p>
                <CreditoLink id={c.id} numero={c.numero} numeroOrigen={c.refinancia_a_numero} conIcono={false} className="text-[11px]" />
              </div>
              {(c.cobrado_post_castigo ?? 0) > 0 && <StatusBadge label="Pagó ya castigado" variant="success" />}
            </div>
            <div className="flex items-end justify-between">
              <div className="leading-tight">
                <span className="font-mono text-xl font-bold text-destructive">{formatMonto(riesgo)}</span>
                <span className="block text-[10px] text-muted-foreground">
                  en riesgo · prestado {formatMonto(prestado)} · volvió {formatMonto(cobrado)}
                </span>
              </div>
              <span className="text-[11px] text-muted-foreground">hace {formatDias(diasCastigado)}</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setGestionando(c.id)}
                className="flex items-center justify-center gap-1.5 rounded-lg border border-border py-2 text-xs font-medium text-muted-foreground"
              >
                <Phone className="h-3.5 w-3.5" /> Gestionar
              </button>
              <button
                type="button"
                onClick={() => setCerrando(c.id)}
                className="flex items-center justify-center gap-1.5 rounded-lg border border-success/30 bg-success/10 py-2 text-xs font-semibold text-success"
              >
                <HandCoins className="h-3.5 w-3.5" /> Cerrar
              </button>
            </div>
          </div>
        )}
      />

      {/*
        La gestión se abre sobre la FILA ya calculada: así el diálogo muestra el mismo importe
        sugerido que la columna "Ofrecerle", sin recalcularlo por su cuenta.
      */}
      {(() => {
        const f = filas.find((x) => x.c.id === gestionando);
        return (
          <GestionCasoDialog
            credito={f?.c ?? null}
            oferta={f?.oferta ?? null}
            diasCastigado={f?.diasCastigado ?? 0}
            onClose={() => setGestionando(null)}
          />
        );
      })()}

      <CerrarCasoDialog
        creditoId={cerrando}
        onClose={() => setCerrando(null)}
        // Cerrado deja de ser incobrable: sale de esta lista y los KPI se recalculan.
        onCerrado={() => mutate()}
      />

      {/*
        La regla del piso, dicha UNA vez y abajo de la tabla que la usa: es el criterio con el
        que se decide cuánto aceptar, y sin él las dos columnas de arriba son dos números más.
      */}
      <p className="text-[11px] leading-relaxed text-muted-foreground/80">
        Lo que se reclama es la deuda nominal: el capital con el que nació la refinanciación,
        más el interés de ese plan y los punitorios acumulados hasta el día del castigo — por
        eso puede ser varias veces la plata que se prestó. "Prestado" es la
        plata que de verdad salió de la caja —el crédito original, no la deuda consolidada— y
        "volvió" es todo lo cobrado en cualquier eslabón de la cadena. Para decidir cuánto
        aceptar, el número es el <strong className="text-foreground">capital en riesgo</strong>:
        arriba de eso la financiera no perdió plata prestada, y cualquier peso por debajo sigue
        siendo recupero sobre algo que ya estaba dado por perdido. La columna{" "}
        <strong className="text-foreground">Ofrecerle</strong> es ese capital ajustado por lo
        que hace más difícil el cobro —cuánto hace que está castigado— y por lo que lo hace más
        fácil —si apareció a pagar algo—. Es una sugerencia, no un límite: el criterio se
        configura en Cobranza → Refinanciaciones.
      </p>
    </div>
  );
}
