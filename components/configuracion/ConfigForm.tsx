"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Settings, Check, Loader2, Percent, Plus, X, MessageSquare, Phone, Mail } from "lucide-react";
import { useConfiguracion, type ConfiguracionFinanciera, type GamificacionConfig } from "@/lib/swr";
import type { SimuladorConfig, CargosConfig, FrecuenciaOpcion } from "@/lib/domain";
import { PageHeader } from "@/components/ui/PageHeader";
import { Field, Input, Select } from "@/components/ui/field";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Skeleton } from "@/components/ui/skeleton";
import { formatFecha } from "@/lib/utils";

const ordenLabel: Record<string, string> = {
  mora: "Mora",
  interes: "Interés",
  capital: "Capital",
};

export function ConfigForm() {
  const { config, error, isLoading, mutate } = useConfiguracion();

  const [form, setForm] = useState<ConfiguracionFinanciera | null>(null);
  // Guardado por bloque: qué bloque se está guardando / acaba de guardarse.
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [savedKey, setSavedKey] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"motor" | "simulador" | "comunicaciones" | "gamificacion">("motor");
  const [mounted, setMounted]    = useState(false);
  useEffect(() => setMounted(true), []);

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
      setSaveError(e instanceof Error ? e.message : "Error al guardar");
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
        <div className="space-y-4 max-w-3xl">
          {saveError && (
            <div className="rounded-xl bg-destructive/10 border border-destructive/30 p-3 text-destructive text-sm">
              {saveError}
            </div>
          )}

          {/* ─ Tabs ─ */}
          <div className="relative flex gap-1 bg-muted/30 rounded-lg p-1 w-fit">
            {([
              { key: "motor",          label: "Motor" },
              { key: "simulador",      label: "Simulador" },
              { key: "comunicaciones", label: "Comunicaciones" },
              { key: "gamificacion",   label: "Gamificación" },
            ] as const).map(tab => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`relative px-3 py-1.5 rounded-md text-xs font-medium transition-colors duration-200 ${
                  activeTab === tab.key ? "text-foreground" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {activeTab === tab.key && mounted && (
                  <motion.div
                    layoutId="config-tab-capsule"
                    className="absolute inset-0 rounded-md bg-card shadow-sm"
                    transition={{ type: "spring", stiffness: 400, damping: 35 }}
                  />
                )}
                {activeTab === tab.key && !mounted && (
                  <div className="absolute inset-0 rounded-md bg-card shadow-sm" />
                )}
                <span className="relative">{tab.label}</span>
              </button>
            ))}
          </div>

          {/* ─── Motor tab: Motor financiero (primero) ─── */}
          {activeTab === "motor" && (
          <Section title="Motor financiero" desc="Cómo se interpreta la tasa y el sistema de cálculo."
            onSave={() => save("motor", { convencionTasa: form.convencionTasa, sistemaAmortizacion: form.sistemaAmortizacion })}
            saving={savingKey === "motor"} saved={savedKey === "motor"}>
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
          <Section title="Financiación del simulador" desc="Rango de monto y valores que el simulador prellena. 0 = sin restricción / sin valor por defecto."
            onSave={() => saveSim("financiacion")} saving={savingKey === "financiacion"} saved={savedKey === "financiacion"}>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <Field label="Monto mínimo ($)">
                <Input type="number" min="0" step="any" value={form.simulador.montoMin}
                  onChange={e => setSim("montoMin", parseFloat(e.target.value) || 0)} />
              </Field>
              <Field label="Monto máximo ($)" hint="0 = sin tope">
                <Input type="number" min="0" step="any" value={form.simulador.montoMax}
                  onChange={e => setSim("montoMax", parseFloat(e.target.value) || 0)} />
              </Field>
              <Field label="Monto por defecto ($)">
                <Input type="number" min="0" step="any" value={form.simulador.montoDefault}
                  onChange={e => setSim("montoDefault", parseFloat(e.target.value) || 0)} />
              </Field>
              <Field label="Tasa base (%)" hint="Prellena la tasa del simulador">
                <div className="relative">
                  <Input type="number" min="0" step="0.5" value={form.simulador.tasaBase}
                    onChange={e => setSim("tasaBase", parseFloat(e.target.value) || 0)} className="pr-7" />
                  <Percent className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
                </div>
              </Field>
            </div>
          </Section>

          {/* Simulador · Plazos */}
          <Section title="Plazos disponibles" desc="Cuotas que se ofrecen en el simulador. Tocá un plazo para activarlo o desactivarlo."
            onSave={() => saveSim("plazos")} saving={savingKey === "plazos"} saved={savedKey === "plazos"}>
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
          <Section title="Frecuencias de pago" desc="Frecuencias ofrecidas en el simulador. Las base no se editan; podés agregar propias (ej. quincenal)."
            onSave={() => saveSim("frecuencias")} saving={savingKey === "frecuencias"} saved={savedKey === "frecuencias"}>
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
          <Section title="Redondeo de cuota" desc="Ajuste del valor de la cuota total."
            onSave={() => saveSim("redondeo")} saving={savingKey === "redondeo"} saved={savedKey === "redondeo"}>
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
          <Section title="Cronograma de cobranza" desc="Fecha de corte, día de vencimiento fijo, gracia y feriados. Solo aplica a créditos mensuales; se congela al otorgar."
            onSave={() => saveSim("cronograma")} saving={savingKey === "cronograma"} saved={savedKey === "cronograma"}>
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

            <div className="mt-4 flex items-center justify-between rounded-lg border border-border bg-muted/30 px-4 py-3">
              <div>
                <p className="text-sm font-medium text-foreground">Sábado no hábil</p>
                <p className="text-xs text-muted-foreground">Si está activo, los vencimientos que caen sábado también se corren al lunes.</p>
              </div>
              <Toggle checked={form.simulador.incluirSabadoNoHabil} onChange={v => setSim("incluirSabadoNoHabil", v)} />
            </div>

            <div className="mt-4">
              <FeriadosEditor feriados={form.simulador.feriados} onChange={f => setSim("feriados", f)} />
            </div>

            {(form.simulador.diaCorte || form.simulador.diaVencimientoFijo) && (
              <p className="mt-4 rounded-lg bg-muted/20 border border-border/60 px-3 py-2 text-[11px] text-muted-foreground/80">
                Ejemplo: corte <b>{form.simulador.diaCorte ?? "—"}</b>, vencimiento <b>{form.simulador.diaVencimientoFijo ?? "—"}</b>. Un crédito otorgado después del corte pasa su 1ª cuota a la liquidación siguiente; si el vencimiento cae domingo/feriado, se corre al día hábil siguiente.
              </p>
            )}
          </Section>

          {/* Simulador · Cargos */}
          <Section title="Cargos del crédito" desc="Comisiones e impuestos que se suman a la cuota o al costo total. Todo desactivado = cuota pura.">
            <div className="space-y-3">
              {/* Comisión de otorgamiento */}
              <CargoBlock title="Comisión de otorgamiento" desc="Cargo único por dar el crédito."
                activo={form.simulador.cargos.comisionOtorgamiento.activo}
                onToggle={v => setCargo("comisionOtorgamiento", "activo", v)}
                onSave={() => saveSim("cargo-comision")} saving={savingKey === "cargo-comision"} saved={savedKey === "cargo-comision"}>
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
              <CargoBlock title="IVA sobre interés" desc="Impuesto sobre el interés de cada cuota."
                activo={form.simulador.cargos.iva.activo}
                onToggle={v => setCargo("iva", "activo", v)}
                onSave={() => saveSim("cargo-iva")} saving={savingKey === "cargo-iva"} saved={savedKey === "cargo-iva"}>
                <div className="max-w-[12rem]">
                  <Field label="Tasa de IVA (%)">
                    <Input type="number" min="0" step="0.5" value={Number((form.simulador.cargos.iva.tasa * 100).toFixed(2))}
                      onChange={e => setCargo("iva", "tasa", (parseFloat(e.target.value) || 0) / 100)} />
                  </Field>
                </div>
              </CargoBlock>

              {/* Seguro */}
              <CargoBlock title="Seguro" desc="Cobertura aplicada por período."
                activo={form.simulador.cargos.seguro.activo}
                onToggle={v => setCargo("seguro", "activo", v)}
                onSave={() => saveSim("cargo-seguro")} saving={savingKey === "cargo-seguro"} saved={savedKey === "cargo-seguro"}>
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
              <CargoBlock title="Gastos administrativos" desc="Cargo por cuota."
                activo={form.simulador.cargos.gastosAdministrativos.activo}
                onToggle={v => setCargo("gastosAdministrativos", "activo", v)}
                onSave={() => saveSim("cargo-gastos")} saving={savingKey === "cargo-gastos"} saved={savedKey === "cargo-gastos"}>
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
          <Section title="Interés por mora" desc="Recargo aplicado por días de atraso."
            onSave={() => save("mora", { moraActiva: form.moraActiva, tasaMoraDiaria: form.tasaMoraDiaria, baseMora: form.baseMora })}
            saving={savingKey === "mora"} saved={savedKey === "mora"}>
            <div className="flex items-center justify-between rounded-lg border border-border bg-muted/30 px-4 py-3 mb-4">
              <div>
                <p className="text-sm font-medium text-foreground">Cobrar mora</p>
                <p className="text-xs text-muted-foreground">Si está desactivado, no se aplica interés moratorio.</p>
              </div>
              <Toggle checked={form.moraActiva} onChange={v => set("moraActiva", v)} />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
              <Field label="Base de cálculo" hint="Sobre qué monto se calcula la mora">
                <Select value={form.baseMora} onChange={e => set("baseMora", e.target.value as ConfiguracionFinanciera["baseMora"])} disabled={!form.moraActiva}>
                  <option value="cuota">Valor de la cuota</option>
                  <option value="saldo">Saldo pendiente</option>
                </Select>
              </Field>
            </div>
          </Section>

          {/* Imputación */}
          <Section title="Orden de imputación de pagos" desc="Cómo se aplica cada pago recibido sobre la deuda."
            onSave={() => save("imputacion", { imputarCargos: form.imputarCargos })}
            saving={savingKey === "imputacion"} saved={savedKey === "imputacion"}>
            <div className="flex items-center gap-2 flex-wrap">
              {form.ordenImputacion.map((c, i) => (
                <div key={c} className="flex items-center gap-2">
                  <StatusBadge
                    label={`${i + 1}. ${ordenLabel[c] ?? c}`}
                    variant={c === "mora" ? "destructive" : c === "interes" ? "warning" : "primary"}
                  />
                  {i < form.ordenImputacion.length - 1 && <span className="text-muted-foreground/40">→</span>}
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground/60 mt-3">
              El reordenamiento de mora/interés/capital llegará en una fase próxima. Hoy el motor aplica este orden.
            </p>

            <div className="mt-4 max-w-md border-t border-border pt-4">
              <Field label="Imputación de cargos" hint="Dónde entran IVA/seguro/gastos del período al imputar un pago">
                <Select value={form.imputarCargos} onChange={e => set("imputarCargos", e.target.value as ConfiguracionFinanciera["imputarCargos"])}>
                  <option value="integrado">Integrado — Mora → Interés → Cargos → Capital</option>
                  <option value="separado">Separado — Mora → Cargos → Interés → Capital</option>
                </Select>
              </Field>
            </div>
          </Section>

          {/* Presentación */}
          <Section title="Presentación" desc="Formato de moneda y región (no afecta los cálculos)."
            onSave={() => save("presentacion", { moneda: form.moneda, locale: form.locale })}
            saving={savingKey === "presentacion"} saved={savedKey === "presentacion"}>
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
          >
            <div className="space-y-4">
              {/* WhatsApp Cloud API */}
              <CanalesBlock
                icon={<MessageSquare className="w-4 h-4 text-success" />}
                title="WhatsApp Cloud API (Meta)"
                enabled={!!form.whatsappConfig?.enabled}
                onToggle={(v) => set("whatsappConfig", { ...(form.whatsappConfig ?? defaultWhatsapp()), enabled: v })}
                onSave={() => save("canal-whatsapp", { whatsappConfig: form.whatsappConfig ?? null } as any)}
                saving={savingKey === "canal-whatsapp"}
                saved={savedKey === "canal-whatsapp"}
              >
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
                  <Field label="Token de acceso permanente">
                    <Input
                      type="password"
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
                enabled={!!form.smsConfig?.enabled}
                onToggle={(v) => set("smsConfig", { ...(form.smsConfig ?? defaultSms()), enabled: v })}
                onSave={() => save("canal-sms", { smsConfig: form.smsConfig ?? null } as any)}
                saving={savingKey === "canal-sms"}
                saved={savedKey === "canal-sms"}
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
                    <Input
                      type="password"
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
                enabled={!!form.emailConfig?.enabled}
                onToggle={(v) => set("emailConfig", { ...(form.emailConfig ?? defaultEmail()), enabled: v })}
                onSave={() => save("canal-email", { emailConfig: form.emailConfig ?? null } as any)}
                saving={savingKey === "canal-email"}
                saved={savedKey === "canal-email"}
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
                      <Field label="Contraseña"><Input type="password" value={(form.emailConfig as any)?.pass ?? ""} onChange={e => set("emailConfig", { ...(form.emailConfig ?? defaultEmail()), pass: e.target.value })} /></Field>
                    </>
                  ) : (
                    <Field label="API Key"><Input type="password" placeholder="re_xxxx / SG.xxxx" value={(form.emailConfig as any)?.api_key ?? ""} onChange={e => set("emailConfig", { ...(form.emailConfig ?? defaultEmail()), api_key: e.target.value })} /></Field>
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
            onSave={() => save("gamificacion", { gamificacionConfig: g } as Partial<ConfiguracionFinanciera>)}
            saving={savingKey === "gamificacion"} saved={savedKey === "gamificacion"}
          >
            <div className="space-y-5">
              {/* Habilitado + período */}
              <div className="flex flex-wrap items-end justify-between gap-4">
                <Field label="Período de evaluación" hint="Largo de cada meta/medalla">
                  <Select value={g.periodo} onChange={e => setGam({ periodo: e.target.value as GamificacionConfig["periodo"] })}>
                    <option value="mensual">Mensual</option>
                    <option value="trimestral">Trimestral</option>
                    <option value="semestral">Semestral</option>
                  </Select>
                </Field>
                <label className="flex items-center gap-2 text-sm text-foreground">
                  <Toggle checked={g.habilitado} onChange={(v) => setGam({ habilitado: v })} />
                  Gamificación habilitada
                </label>
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

        </div>
      )}
    </div>
  );
}

function defaultGamificacion(): GamificacionConfig {
  return {
    habilitado: true,
    periodo: "mensual",
    pesos: { monto: 50, cantidad: 30, cobranza: 20, calidad: 0 },
    umbrales: { oro: 100, plata: 85, bronce: 70 },
  };
}

function CanalesBlock({ icon, title, enabled, onToggle, children, onSave, saving, saved }: {
  icon: React.ReactNode; title: string; enabled: boolean; onToggle: (v: boolean) => void; children: React.ReactNode;
  onSave?: () => void; saving?: boolean; saved?: boolean;
}) {
  return (
    <div className="rounded-lg border border-border bg-muted/20 p-4">
      <div className="flex items-center justify-between gap-3 mb-1">
        <div className="flex items-center gap-2">
          {icon}
          <p className="text-sm font-medium text-foreground">{title}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Toggle checked={enabled} onChange={onToggle} />
          {onSave && <SaveButton saving={!!saving} saved={!!saved} onClick={onSave} />}
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

function Section({ title, desc, children, onSave, saving, saved }: {
  title: string; desc?: string; children: React.ReactNode;
  onSave?: () => void; saving?: boolean; saved?: boolean;
}) {
  return (
    <div className="rounded-xl bg-card border border-border p-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
          {desc && <p className="text-xs text-muted-foreground mt-0.5">{desc}</p>}
        </div>
        {onSave && <SaveButton saving={!!saving} saved={!!saved} onClick={onSave} />}
      </div>
      {children}
    </div>
  );
}

function SaveButton({ saving, saved, onClick }: { saving: boolean; saved: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={saving}
      className="flex shrink-0 items-center gap-1.5 rounded-lg border border-primary/20 bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/15 disabled:opacity-50 transition-colors"
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
        <div key={f.clave} className="flex items-center gap-3 rounded-lg border border-border bg-muted/20 px-3 py-2">
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

function CargoBlock({ title, desc, activo, onToggle, children, onSave, saving, saved }: {
  title: string; desc?: string; activo: boolean; onToggle: (v: boolean) => void; children: React.ReactNode;
  onSave?: () => void; saving?: boolean; saved?: boolean;
}) {
  return (
    <div className="rounded-lg border border-border bg-muted/20 p-4">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">{title}</p>
          {desc && <p className="text-xs text-muted-foreground">{desc}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Toggle checked={activo} onChange={onToggle} />
          {onSave && <SaveButton saving={!!saving} saved={!!saved} onClick={onSave} />}
        </div>
      </div>
      <div className={activo ? "" : "pointer-events-none opacity-40"}>{children}</div>
    </div>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full px-0.5 transition-colors ${checked ? "bg-primary" : "bg-muted"}`}
    >
      <span
        className={`inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-200 ${checked ? "translate-x-5" : "translate-x-0"}`}
      />
    </button>
  );
}

function BodySkeleton() {
  return (
    <div className="space-y-4 max-w-3xl">
      {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-40 rounded-xl" />)}
    </div>
  );
}
