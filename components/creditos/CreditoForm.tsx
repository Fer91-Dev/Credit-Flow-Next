"use client";

import { useState, useEffect, useMemo } from "react";
import { motion } from "framer-motion";
import { DollarSign, Eye, EyeOff, Info, Percent, Search, UserPlus, X, RefreshCw, PanelLeftClose, PanelLeftOpen, ListOrdered } from "lucide-react";
import { Emoji } from "@/components/ui/Emoji";
import { Field, Input, Select } from "@/components/ui/field";
import { ClienteForm, type ClienteCreado } from "@/components/clientes/ClienteForm";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogFooter,
  AlertDialogTitle, AlertDialogDescription, AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { useConfiguracion, useMiPerfilVendedor, useMiCaja, useFinanciera, type CuentaCaja, type Producto } from "@/lib/swr";
import { useConfirm } from "@/components/ui/confirm";
import { useToast } from "@/components/ui/toast";
import { formatNumero, parseMontoInput, maskMontoInput, numeroAInput, formatFecha, formatMonto, formatCreditoNumero, nombreCompleto } from "@/lib/utils";
import { imprimirPlanPagos } from "@/lib/plan-print";
import {
  construirPlanAmortizacion,
  tasaPeriodicaSegunConvencion,
  efectivaAnualDesdePeriodica,
  frecuenciaLabel,
  cargoColumnasActivas,
  type Frecuencia,
  type ConvencionTasa,
  type PlanAmortizacion,
} from "@/lib/domain";

const CUENTA_DESEMBOLSO_LABEL: Record<CuentaCaja, string> = {
  efectivo: "Efectivo",
  banco: "Transferencia (Banco)",
  dolares: "Dólares",
};

interface Cliente { id: string; nombre: string; apellido?: string | null; documento?: string | null }

/** Resultado de la evaluación de riesgo (preview del simulador). */
interface EvalRiesgo {
  semaforo: "aprobado" | "revisar" | "rechazado";
  motivos: string[];
  ratioCuotaIngreso: number | null;
  bloquea: boolean;
  ingresoNetoMensual: number;
  /** Suma de cuotas mensuales de otros créditos vivos del cliente. */
  deudaCuotaMensualVigente: number;
  /** Cantidad de créditos vivos (activos + vencidos) del cliente. */
  creditosActivos: number;
  cuotaEstimada: number;
  capacidad: { cuotaMaxima: number; montoIndicativo: number };
  scoreInterno: { categoria: string; label: string };
  /** Monto máximo sugerido según el sueldo (capacidad de pago + tope por ingreso). 0 = sin margen. */
  montoMaximoSugerido: number;
}

interface CreditoFormProps {
  creditoId?: string | null;
  onClose: (success?: boolean) => void;
}

/* ── Formato de moneda es-AR (helpers centralizados en lib/utils) ─────────────── */
// `parseMonto`/`formatMontoInput` son alias locales de los helpers compartidos para
// minimizar el ruido en los call sites de este formulario.
const parseMonto = parseMontoInput;
const formatMontoInput = maskMontoInput;
const n2 = (num: number) => formatNumero(num, 2);
const n0 = (num: number) => formatNumero(num, 0);

const fmtDate = (d: Date) => formatFecha(d);

/* ── Debounce: simulador calmo (no recalcula en cada tecla) ───────────────── */
function useDebounced<T>(value: T, delay = 350): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

export function CreditoForm({ creditoId, onClose }: CreditoFormProps) {
  const { config } = useConfiguracion();
  const { financiera } = useFinanciera(); // co-branding del PDF (nombre/logo)
  const { perfil } = useMiPerfilVendedor(); // límite de otorgamiento del usuario (null si es admin/sin tope)
  const { caja: miCaja, mutate: refrescarCaja } = useMiCaja(); // caja de la que desembolsa el usuario (vendedor: su caja; admin: caja principal); fondos para otorgar
  const [refrescandoCaja, setRefrescandoCaja] = useState(false);
  // Recarga PARCIAL del saldo: revalida solo /api/me/caja (mi caja) sin recargar la página
  // ni perder los datos del formulario. Al volver, `dispDesembolso`/`fondosInsuficientes` se
  // recalculan solos (derivados en el render) → si ya alcanza, el aviso rojo desaparece y el
  // botón "Otorgar" se habilita.
  const refrescarSaldo = async () => {
    setRefrescandoCaja(true);
    try { await refrescarCaja(); } finally { setRefrescandoCaja(false); }
  };
  const confirm = useConfirm();
  const toast = useToast();
  const convencion: ConvencionTasa = config?.convencionTasa ?? "nominal_anual";

  // Parámetros del simulador definidos por el tenant en Configuración.
  const simCfg = config?.simulador;
  const catalogoFrec = simCfg?.frecuencias ?? [];
  const plazosActivos = (simCfg?.plazos ?? []).filter(p => p.activo).map(p => p.cuotas);
  const frecsActivas = catalogoFrec.filter(f => f.activo);
  const hayCargos = !!simCfg && (
    simCfg.cargos.iva.activo || simCfg.cargos.seguro.activo ||
    simCfg.cargos.gastosAdministrativos.activo || simCfg.cargos.comisionOtorgamiento.activo
  );
  // Columnas de cargos per-cuota activas (IVA / Seguro / Gastos) para discriminarlas
  // en el detalle del operador. La comisión es upfront → no genera columna.
  const cargoCols = simCfg ? cargoColumnasActivas(simCfg.cargos) : [];
  const hayCargoCols = cargoCols.length > 0;

  // Estado inicial vacío: el simulador no muestra ningún plan hasta que el operador complete todos los campos.
  const [formData, setFormData] = useState({
    cliente_id: "", tipo_credito: "personal",
    monto_original: "", tasa: "", plazo_meses: "",
    frecuencia: "mensual" as Frecuencia,
    vendedor_id: "",
    cuenta_desembolso: "efectivo" as CuentaCaja,
    // Crédito de PRODUCTO: el cliente se lleva un producto en vez de dinero.
    producto_categoria: "", producto_id: "", producto_cantidad: "1",
  });
  const [productos, setProductos] = useState<Producto[]>([]);
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [vendedores, setVendedores] = useState<{ id: string; nombre: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [vista, setVista] = useState<"operador" | "cliente">("operador");
  const [mounted, setMounted] = useState(false);
  // Calculadora (parámetros) colapsable: se esconde barriendo a la izquierda para dar todo
  // el ancho al cronograma. Clave para leer el detalle de cuotas en pantallas chicas.
  const [calcAbierta, setCalcAbierta] = useState(true);
  useEffect(() => setMounted(true), []);
  const [prefilled, setPrefilled] = useState(false);
  // Alta rápida de cliente desde el buscador (cuando el DNI no existe).
  const [alta, setAlta] = useState<{ open: boolean; doc: string }>({ open: false, doc: "" });
  // Aviso de confirmación previo al otorgamiento (evita crear el crédito por un Enter o clic accidental).
  const [confirmOpen, setConfirmOpen] = useState(false);
  // Crédito ya creado → pantalla de éxito (numero generado).
  const [created, setCreated] = useState<{ numero: number | null; monto_original: number } | null>(null);

  // ── Riesgo / originación (motor base: todos los planes; la verificación de bureau es lo premium) ──
  const tieneRiesgo = true;
  const esAdmin = !perfil; // useMiPerfilVendedor devuelve null para admin; el vendedor trae ficha
  const [riesgoEval, setRiesgoEval] = useState<EvalRiesgo | null>(null);
  const [riesgoLoading, setRiesgoLoading] = useState(false);
  const [autorizarRiesgo, setAutorizarRiesgo] = useState(false);

  const abrirAlta = (query: string) => {
    // Solo los dígitos del término van al campo DNI (nunca el nombre).
    const doc = query.replace(/\D/g, "").slice(0, 8);
    setAlta({ open: true, doc });
  };
  const handleAltaClose = (success?: boolean, creado?: ClienteCreado) => {
    setAlta({ open: false, doc: "" });
    if (success && creado) {
      setClientes(prev => [{ id: creado.id, nombre: creado.nombre, apellido: creado.apellido ?? null, documento: creado.documento ?? null }, ...prev]);
      setFormData(p => ({ ...p, cliente_id: creado.id }));
    }
  };

  useEffect(() => {
    fetch("/api/clientes?limit=1000")
      .then(r => r.json())
      .then(j => { if (j.ok) setClientes(j.data.clientes || []); });
    fetch("/api/vendedores?activo=true")
      .then(r => r.json())
      .then(j => { if (j.ok) setVendedores((j.data.vendedores || []).map((v: { id: string; nombre: string }) => ({ id: v.id, nombre: v.nombre }))); });
    fetch("/api/productos?disponible=true&activo=true")
      .then(r => r.json())
      .then(j => { if (j.ok) setProductos(j.data.productos || []); });
    if (creditoId) fetchCredito();
  }, [creditoId]);

  // Prellenar solo monto y tasa desde los defaults del tenant (NO el plazo ni la frecuencia).
  // El plazo se configura en Configuración por frecuencia; no hay "plan por defecto".
  useEffect(() => {
    if (creditoId || prefilled || !simCfg) return;
    setFormData(p => ({
      ...p,
      monto_original: p.monto_original || (simCfg.montoDefault > 0 ? numeroAInput(simCfg.montoDefault) : ""),
      tasa: p.tasa || (simCfg.tasaBase > 0 ? String(simCfg.tasaBase) : ""),
    }));
    setPrefilled(true);
  }, [simCfg, creditoId, prefilled]); // eslint-disable-line react-hooks/exhaustive-deps

  // El campo N° de cuotas es siempre editable, independientemente de la frecuencia.
  // Los plazos disponibles vienen de Configuración (el operador puede agregar 15 para quincenal, etc.)
  const esMensual = formData.frecuencia === "mensual";

  // ── Crédito de PRODUCTO ───────────────────────────────────────────────────
  // El cliente se lleva un producto en vez de dinero: el capital = precio × cantidad
  // (read-only) y NO hay desembolso de efectivo (no se valida caja). El control es el stock.
  const esProducto = formData.tipo_credito === "productos";
  const categoriasProd = useMemo(
    () => Array.from(new Set(productos.map(p => p.categoria).filter((c): c is string => !!c))).sort(),
    [productos],
  );
  const productosFiltrados = formData.producto_categoria
    ? productos.filter(p => p.categoria === formData.producto_categoria)
    : productos;
  const productoSel = productos.find(p => p.id === formData.producto_id);
  const cantidadProd = Math.max(1, parseInt(formData.producto_cantidad) || 1);

  // Cuando es producto, el capital queda fijado al precio × cantidad del producto elegido.
  useEffect(() => {
    if (!esProducto || !productoSel) return;
    const capital = productoSel.precio * cantidadProd;
    setFormData(p => {
      const nuevo = numeroAInput(capital);
      return p.monto_original === nuevo ? p : { ...p, monto_original: nuevo };
    });
  }, [esProducto, productoSel, cantidadProd]);

  const fetchCredito = async () => {
    try {
      const res = await fetch(`/api/creditos/${creditoId}`);
      const json = await res.json();
      if (json.ok) {
        const { cliente_id, tipo_credito, monto_original, tasa, plazo_meses, frecuencia, vendedor_id, producto_id, producto_cantidad } = json.data;
        setFormData({
          cliente_id, tipo_credito,
          monto_original: numeroAInput(monto_original),
          tasa: String(tasa), plazo_meses: String(plazo_meses),
          frecuencia: (frecuencia ?? "mensual") as Frecuencia,
          vendedor_id: vendedor_id ?? "",
          cuenta_desembolso: "efectivo",
          producto_categoria: "",
          producto_id: producto_id ?? "",
          producto_cantidad: producto_cantidad != null ? String(producto_cantidad) : "1",
        });
      }
    } catch { setError("Error al cargar crédito"); }
  };

  const set = (field: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setError(null); // el aviso de validación se limpia al editar
    setFormData(p => ({ ...p, [field]: e.target.value }));
  };

  const setMonto = (e: React.ChangeEvent<HTMLInputElement>) => {
    setError(null);
    setFormData(p => ({ ...p, monto_original: formatMontoInput(e.target.value) }));
  };

  /** Valida los datos del crédito. Todos los campos son obligatorios. */
  const validar = (): string | null => {
    if (!formData.cliente_id) return "Seleccioná un cliente";
    if (!formData.tipo_credito) return "Seleccioná el tipo de crédito";
    if (vendedores.length > 0 && !formData.vendedor_id) return "Seleccioná un vendedor";
    // Crédito de producto: validar elección y stock (el capital lo fija el producto).
    if (esProducto) {
      if (!formData.producto_id || !productoSel) return "Seleccioná un producto";
      if (cantidadProd < 1) return "La cantidad debe ser al menos 1";
      if (cantidadProd > productoSel.stock) return `No hay stock suficiente (${productoSel.stock} u. disponibles)`;
    }
    const monto = parseMonto(formData.monto_original);
    if (monto <= 0) return "Ingresá un capital válido";
    if (simCfg && simCfg.montoMin > 0 && monto < simCfg.montoMin) return `El capital mínimo es $${n0(simCfg.montoMin)}`;
    if (simCfg && simCfg.montoMax > 0 && monto > simCfg.montoMax) return `El capital máximo es $${n0(simCfg.montoMax)}`;
    // Límite de otorgamiento del vendedor (al otorgar, no en edición). El admin no tiene tope.
    if (!creditoId && perfil?.limite_aprobacion != null && monto > perfil.limite_aprobacion)
      return `El capital supera tu límite de otorgamiento ($${n0(perfil.limite_aprobacion)}). Requiere autorización de un administrador.`;
    // Fondos disponibles en la cuenta de desembolso (solo créditos de dinero; el producto no desembolsa).
    // miCaja = la caja de la que desembolsa el usuario (vendedor: su caja; admin: caja principal).
    if (!esProducto && !creditoId && miCaja && monto > (miCaja.saldos_por_cuenta[formData.cuenta_desembolso] ?? 0))
      return `No hay saldo suficiente en la caja de ${CUENTA_DESEMBOLSO_LABEL[formData.cuenta_desembolso]} ($${n0(miCaja.saldos_por_cuenta[formData.cuenta_desembolso] ?? 0)}). Cargá fondos a la caja o cambiá la forma de desembolso.`;
    if (!formData.frecuencia) return "Seleccioná la frecuencia";
    const n = parseInt(formData.plazo_meses);
    if (isNaN(n) || n < 1) return "Indicá el número de cuotas";
    const t = parseFloat(formData.tasa);
    if (isNaN(t) || t <= 0) return "Ingresá la tasa de interés";
    if (!plan) return "Completá los datos para simular el plan";
    return null;
  };

  // Submit del form. En ALTA no crea directo: abre el aviso de confirmación, de modo
  // que un Enter o un clic accidental nunca otorga el crédito. En edición guarda directo.
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const err = validar();
    if (err) { setError(err); return; }
    setError(null);
    if (creditoId) {
      // Edición: confirmar antes de guardar (el alta usa su propio aviso enriquecido).
      const ok = await confirm({
        title: "¿Guardar cambios del crédito?",
        description: "Se actualizarán los parámetros del crédito.",
        confirmLabel: "Guardar cambios",
      });
      if (!ok) return;
      persist();
      return;
    }
    setConfirmOpen(true);
  };

  // Persiste el crédito (POST en alta, PATCH en edición). Al crear muestra la pantalla de éxito.
  const persist = async () => {
    setLoading(true);
    setError(null);
    try {
      const monto = parseMonto(formData.monto_original);
      const body = {
        cliente_id: formData.cliente_id,
        tipo_credito: formData.tipo_credito,
        monto_original: monto,
        tasa: parseFloat(formData.tasa) || 0,
        plazo_meses: parseInt(formData.plazo_meses),
        frecuencia: formData.frecuencia,
        vendedor_id: formData.vendedor_id || null,
        cuenta_desembolso: formData.cuenta_desembolso,
        // Autorización manual del admin cuando el cliente no califica (feature riesgo).
        ...(riesgoRechazado && esAdmin && autorizarRiesgo ? { autorizacion_riesgo: true } : {}),
        // Crédito de producto: el backend recalcula el capital (precio × cantidad) y descuenta stock.
        ...(esProducto ? { producto_id: formData.producto_id, producto_cantidad: cantidadProd } : {}),
      };
      const res = await fetch(creditoId ? `/api/creditos/${creditoId}` : "/api/creditos", {
        method: creditoId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (json.ok) {
        if (creditoId) {
          toast.success("Crédito actualizado");
          onClose(true);
        } else {
          setConfirmOpen(false);
          setCreated({ numero: json.data?.numero ?? null, monto_original: json.data?.monto_original ?? monto });
        }
      } else {
        setConfirmOpen(false);
        setError(json.error);
      }
    } catch (err) {
      setConfirmOpen(false);
      setError(err instanceof Error ? err.message : "Error");
    } finally {
      setLoading(false);
    }
  };

  // Entradas que disparan el simulador, con debounce para una experiencia calma.
  const sim = useDebounced(
    { monto: formData.monto_original, tasa: formData.tasa, plazo: formData.plazo_meses, frecuencia: formData.frecuencia },
    350
  );
  const calculando =
    sim.monto !== formData.monto_original ||
    sim.tasa !== formData.tasa ||
    sim.plazo !== formData.plazo_meses ||
    sim.frecuencia !== formData.frecuencia;

  // Preview de riesgo/originación: evalúa al cliente contra la política del tenant cuando
  // cambian cliente/monto/tasa/plazo (feature premium; solo en alta, no en edición).
  useEffect(() => {
    if (!tieneRiesgo || creditoId) { setRiesgoEval(null); return; }
    const monto = parseMonto(sim.monto);
    const tasa = parseFloat(sim.tasa) || 0;
    const n = parseInt(sim.plazo);
    if (!formData.cliente_id || monto <= 0 || !n || n < 1 || tasa <= 0) { setRiesgoEval(null); return; }
    let cancel = false;
    setRiesgoLoading(true);
    fetch("/api/creditos/evaluar-riesgo", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cliente_id: formData.cliente_id, monto_original: monto, tasa, plazo_meses: n, frecuencia: formData.frecuencia }),
    })
      .then(r => r.json())
      .then(j => { if (cancel) return; setRiesgoEval(j.ok ? j.data : null); setAutorizarRiesgo(false); })
      .catch(() => { if (!cancel) setRiesgoEval(null); })
      .finally(() => { if (!cancel) setRiesgoLoading(false); });
    return () => { cancel = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tieneRiesgo, creditoId, formData.cliente_id, formData.frecuencia, sim.monto, sim.tasa, sim.plazo]);

  const riesgoRechazado = !!(tieneRiesgo && riesgoEval && riesgoEval.semaforo === "rechazado");
  // El otorgamiento se traba si: política dura (bloquea) o falta la autorización del admin.
  const riesgoImpide = riesgoRechazado && (riesgoEval!.bloquea || !(esAdmin && autorizarRiesgo));

  const lbl = frecuenciaLabel(formData.frecuencia, catalogoFrec);

  const plan = useMemo<PlanAmortizacion | null>(() => {
    const monto = parseMonto(sim.monto);
    const tasa = parseFloat(sim.tasa) || 0;
    const n = parseInt(sim.plazo);
    if (monto <= 0 || isNaN(n) || n < 1) return null;
    try {
      return construirPlanAmortizacion(monto, tasa, n, new Date(), convencion, sim.frecuencia,
        simCfg ? { cargos: simCfg.cargos, redondeo: simCfg.redondeoCuota } : undefined,
        catalogoFrec);
    } catch {
      return null;
    }
  }, [sim, convencion, simCfg]);

  const montoNum = parseMonto(sim.monto);

  // Aviso reactivo de fondos: depende del monto INGRESADO y de la cuenta elegida.
  const montoIngresado = parseMonto(formData.monto_original);
  const dispDesembolso = miCaja ? (miCaja.saldos_por_cuenta[formData.cuenta_desembolso] ?? 0) : null;
  // Crédito de producto: no hay desembolso de efectivo → nunca hay "fondos insuficientes".
  const fondosInsuficientes = !esProducto && !creditoId && dispDesembolso != null && montoIngresado > dispDesembolso;

  const tasaEA = useMemo(() => {
    const tasa = parseFloat(sim.tasa) || 0;
    if (tasa <= 0) return 0;
    const ip = tasaPeriodicaSegunConvencion(tasa, convencion, sim.frecuencia, catalogoFrec);
    return efectivaAnualDesdePeriodica(ip, sim.frecuencia, catalogoFrec);
  }, [sim.tasa, sim.frecuencia, convencion, catalogoFrec]);

  const capPct = plan && plan.totalPagado > 0
    ? Math.round((montoNum / plan.totalPagado) * 100)
    : 0;

  const montoHint = simCfg && (simCfg.montoMin > 0 || simCfg.montoMax > 0)
    ? `Permitido: $${n0(simCfg.montoMin)}${simCfg.montoMax > 0 ? ` – $${n0(simCfg.montoMax)}` : " o más"}`
    : "Aceptá miles y decimales: 350.000,52";
  // Total de cuotas (con cargos) para la vista cliente.
  const totalCuotasCliente = plan ? plan.cuotas.reduce((s, r) => s + r.cuotaTotal, 0) : 0;

  const clienteSel = clientes.find(c => c.id === formData.cliente_id);

  function imprimirPlan(vistaImp: "operador" | "cliente") {
    if (!plan) return;
    imprimirPlanPagos({
      capital: montoNum,
      tasa: parseFloat(formData.tasa) || 0,
      convencion,
      freqLabelPlural: lbl.cuotaPlural,
      hayCargos,
      cargoCols,
      cuotas: plan.cuotas.map((r) => ({
        nro: r.nro, fecha: r.fecha, cuota: r.cuota, interes: r.interes, capital: r.capital,
        iva: r.iva, seguro: r.seguro, gastos: r.gastos, cuotaTotal: r.cuotaTotal, saldo: r.saldo,
      })),
      totales: {
        cuota: plan.totalPagado,
        interes: plan.totalIntereses,
        capital: montoNum,
        cargos: plan.totalIva + plan.totalSeguro + plan.totalGastos,
        cuotaTotal: totalCuotasCliente,
      },
      financiera: financiera ? { nombre: financiera.nombre, logo_url: financiera.logo_url } : undefined,
    }, vistaImp);
  }

  // ── Pantalla de éxito: el crédito ya se otorgó (reemplaza el simulador) ──
  if (created) {
    const totalFinal = hayCargos ? totalCuotasCliente : (plan?.totalPagado ?? 0);
    return (
      <div className="flex h-full min-h-0 flex-col items-center justify-center gap-6 p-8 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-success/30 bg-success/15">
          <Emoji name="check-mark-button" className="h-8 w-8" />
        </div>
        <div className="space-y-1.5">
          <h3 className="text-lg font-semibold text-foreground">Crédito otorgado con éxito</h3>
          <p className="text-sm text-muted-foreground">La operación se registró correctamente.</p>
        </div>

        <div className="w-full max-w-sm space-y-4 rounded-xl border border-border bg-card p-5">
          <div className="text-center">
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">N° de crédito</p>
            <p className="mt-1 font-mono text-3xl font-black text-primary">{formatCreditoNumero(created.numero)}</p>
          </div>
          <div className="border-t border-border" />
          <dl className="space-y-2 text-sm">
            <div className="flex items-center justify-between gap-3">
              <dt className="text-muted-foreground">Cliente</dt>
              <dd className="truncate font-medium text-foreground">{clienteSel ? nombreCompleto(clienteSel) : "—"}</dd>
            </div>
            {clienteSel?.documento && (
              <div className="flex items-center justify-between gap-3">
                <dt className="text-muted-foreground">DNI</dt>
                <dd className="font-mono text-foreground">{clienteSel.documento}</dd>
              </div>
            )}
            <div className="flex items-center justify-between gap-3">
              <dt className="text-muted-foreground">Capital</dt>
              <dd className="font-mono font-semibold text-foreground">{formatMonto(created.monto_original)}</dd>
            </div>
            {plan && (
              <>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-muted-foreground">Plan</dt>
                  <dd className="text-foreground">{plan.cuotas.length} {lbl.cuotaPlural}</dd>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <dt className="text-muted-foreground">Total a pagar</dt>
                  <dd className="font-mono font-semibold text-foreground">{formatMonto(totalFinal)}</dd>
                </div>
              </>
            )}
          </dl>
        </div>

        <div className="flex w-full max-w-sm flex-col items-center gap-2 sm:flex-row">
          <button
            type="button"
            onClick={() => imprimirPlan("cliente")}
            className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground sm:flex-1"
          >
            <Emoji name="printer" className="h-4 w-4" /> Imprimir plan
          </button>
          <button
            type="button"
            onClick={() => onClose(true)}
            className="w-full rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 sm:flex-1"
          >
            Cerrar
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
    <div className="flex h-full min-h-0 overflow-hidden">

      {/* ── IZQUIERDA: parámetros del crédito (calculadora colapsable) ── */}
      <form
        onSubmit={handleSubmit}
        className={`flex flex-col w-full md:w-[300px] xl:w-[330px] shrink-0 border-r border-edge bg-card/40 transition-[margin] duration-300 ease-in-out ${
          calcAbierta ? "ml-0" : "-ml-[100%] md:-ml-[300px] xl:-ml-[330px]"
        }`}
        aria-hidden={!calcAbierta}
      >
        {/* Área de campos — scroll interno */}
        <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3">
        {error && (
          <div className="rounded-lg bg-destructive/10 border border-destructive/20 px-2.5 py-2 text-sm text-destructive">
            {error}
          </div>
        )}

        {/* Prestatario */}
        <section className="space-y-2">
          <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Prestatario</p>
          <Field label="Cliente" required>
            <ClienteCombobox
              clientes={clientes}
              value={formData.cliente_id}
              onSelect={id => setFormData(p => ({ ...p, cliente_id: id }))}
              onAlta={abrirAlta}
            />
          </Field>
          <div className={vendedores.length > 0 ? "grid grid-cols-2 gap-2.5" : ""}>
            <Field label="Tipo de crédito" required>
              <Select name="tipo_credito" value={formData.tipo_credito} onChange={set("tipo_credito")} required>
                <option value="personal">Personal</option>
                <option value="empresarial">Empresarial</option>
                <option value="productos">Productos</option>
                <option value="otro">Otro</option>
              </Select>
            </Field>
            {vendedores.length > 0 && (
              <Field label="Vendedor" required>
                <Select name="vendedor_id" value={formData.vendedor_id} onChange={set("vendedor_id")} required>
                  <option value="">Seleccioná…</option>
                  {vendedores.map(v => (
                    <option key={v.id} value={v.id}>{v.nombre}</option>
                  ))}
                </Select>
              </Field>
            )}
          </div>

          {/* Producto a financiar (solo tipo = Productos): el cliente se lleva el producto. */}
          {esProducto && (
            <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 space-y-2.5">
              <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
                <Emoji name="package" className="h-3.5 w-3.5" />
                El cliente se lleva el producto. El precio es el capital y se descuenta del stock.
              </p>
              {productos.length === 0 ? (
                <p className="text-xs text-warning">No hay productos con stock disponible. Cargá inventario en la sección Productos.</p>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-2.5">
                    <Field label="Categoría">
                      <Select
                        name="producto_categoria"
                        value={formData.producto_categoria}
                        onChange={(e) => setFormData(p => ({ ...p, producto_categoria: e.target.value, producto_id: "" }))}
                      >
                        <option value="">Todas</option>
                        {categoriasProd.map(c => <option key={c} value={c}>{c}</option>)}
                      </Select>
                    </Field>
                    <Field label="Cantidad" required>
                      <Input
                        name="producto_cantidad" type="number" min="1"
                        max={productoSel ? String(productoSel.stock) : undefined}
                        value={formData.producto_cantidad} onChange={set("producto_cantidad")}
                        className="text-center font-mono tabular-nums"
                      />
                    </Field>
                  </div>
                  <Field label="Producto" required hint={productoSel ? `Stock disponible: ${productoSel.stock} u.` : undefined}>
                    <Select
                      name="producto_id"
                      value={formData.producto_id}
                      onChange={set("producto_id")}
                      required
                    >
                      <option value="">Seleccioná un producto…</option>
                      {productosFiltrados.map(p => (
                        <option key={p.id} value={p.id} disabled={p.stock <= 0}>
                          {p.nombre} — ${n0(p.precio)} ({p.stock} u.)
                        </option>
                      ))}
                    </Select>
                  </Field>
                  {productoSel && cantidadProd > productoSel.stock && (
                    <p className="text-xs text-destructive">
                      No hay stock suficiente: pediste {cantidadProd} u. y hay {productoSel.stock} disponibles.
                    </p>
                  )}
                </>
              )}
            </div>
          )}
        </section>

        {/* Condiciones */}
        <section className="space-y-2">
          <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Condiciones financieras</p>

          {/* Capital — valor grande, ancho completo. En crédito de producto es read-only (= precio × cantidad). */}
          <Field label="Capital ($)" required hint={esProducto ? "Definido por el producto (precio × cantidad)" : montoHint}>
            <div className="relative">
              <DollarSign className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                name="monto_original" type="text" inputMode="decimal" placeholder="350.000,00"
                value={formData.monto_original} onChange={setMonto}
                required readOnly={esProducto}
                className={`pl-9 text-lg font-bold font-mono tabular-nums ${!esProducto && miCaja ? "pr-10" : ""} ${esProducto ? "opacity-70 cursor-not-allowed" : ""}`}
              />
              {/* Refrescar saldo de la caja: ícono sutil dentro del campo (recarga parcial, sin F5).
                  Delicado y semitransparente, al estilo de los íconos del sidebar. */}
              {!esProducto && miCaja && (
                <button
                  type="button"
                  onClick={refrescarSaldo}
                  disabled={refrescandoCaja}
                  title="Refrescar saldo de la caja"
                  aria-label="Refrescar saldo de la caja"
                  className="absolute right-2 top-1/2 -translate-y-1/2 flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground/40 hover:text-foreground hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 transition-colors disabled:opacity-50"
                >
                  <RefreshCw className={`h-4 w-4 ${refrescandoCaja ? "animate-spin text-primary" : ""}`} />
                </button>
              )}
            </div>
          </Field>

          {/* Forma de desembolso → solo en créditos de dinero (el producto no desembolsa efectivo). */}
          {!esProducto && (
            <>
              <Field label="Forma de desembolso" required>
                <Select name="cuenta_desembolso" value={formData.cuenta_desembolso} onChange={set("cuenta_desembolso")} required>
                  <option value="efectivo">Efectivo</option>
                  <option value="banco">Transferencia (Banco)</option>
                  <option value="dolares">Dólares</option>
                </Select>
              </Field>
              {/* Disponible en la cuenta elegida (el refrescar vive en el ícono del campo Capital) */}
              {miCaja ? (
                <p className="text-xs text-muted-foreground">
                  Disponible en {CUENTA_DESEMBOLSO_LABEL[formData.cuenta_desembolso]}:{" "}
                  <span className={`font-mono font-semibold ${fondosInsuficientes ? "text-destructive" : "text-foreground"}`}>${n0(dispDesembolso ?? 0)}</span>
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">Cuenta de la que sale el dinero prestado</p>
              )}
              {fondosInsuficientes && (
                <p className="flex flex-wrap items-center gap-1 text-xs text-destructive">
                  El capital (${n0(montoIngresado)}) supera el saldo de la caja en {CUENTA_DESEMBOLSO_LABEL[formData.cuenta_desembolso]} (${n0(dispDesembolso ?? 0)}). Pedí una entrega al administrador y tocá
                  <RefreshCw className="inline h-3 w-3" aria-hidden />
                  en el campo Capital para actualizar (sin recargar la página).
                </p>
              )}
            </>
          )}

          {/* Frecuencia (ancha) · Cuotas (chica) · Tasa (chica) — tamaño según el valor */}
          <div className="grid grid-cols-4 gap-2.5">
            <div className="col-span-2">
              <Field label="Frecuencia" required>
                <Select name="frecuencia" value={formData.frecuencia} onChange={set("frecuencia")} required>
                  {frecsActivas.map(f => (
                    <option key={f.clave} value={f.clave}>
                      {f.label.charAt(0).toUpperCase() + f.label.slice(1)}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <div className="col-span-1">
              <Field label="Cuotas" required>
                {plazosActivos.length > 0 ? (
                  <Select name="plazo_meses" value={formData.plazo_meses} onChange={set("plazo_meses")} required>
                    {!formData.plazo_meses && <option value="">—</option>}
                    {plazosActivos.map(p => <option key={p} value={p}>{p}</option>)}
                  </Select>
                ) : (
                  <Input
                    name="plazo_meses" type="number" placeholder="—"
                    value={formData.plazo_meses} onChange={set("plazo_meses")}
                    min="1" max="3650" required
                    className="text-center font-mono tabular-nums px-1"
                  />
                )}
              </Field>
            </div>
            <div className="col-span-1">
              <Field label="Tasa %" required hint={convencion === "mensual" ? "T.M." : convencion === "efectiva_anual" ? "T.E.A." : "T.N.A."}>
                <div className="relative">
                  <Input
                    name="tasa" type="number" placeholder="48"
                    value={formData.tasa} onChange={set("tasa")}
                    min="0" step="0.5" required className="pr-5 text-center font-mono tabular-nums px-1"
                  />
                  <Percent className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
                </div>
              </Field>
            </div>
          </div>
        </section>

        {/* ── Riesgo / originación (feature premium) ── */}
        {tieneRiesgo && !creditoId && (riesgoLoading || riesgoEval) && (
          <section className="px-5 pb-5">
            {!riesgoEval ? (
              <div className="rounded-xl border border-border bg-card p-4 text-xs text-muted-foreground">Evaluando riesgo…</div>
            ) : (() => {
              const meta = {
                aprobado:  { ring: "ring-success/30",     bg: "bg-success/5",     text: "text-success",     dot: "bg-success",     label: "Aprobado" },
                revisar:   { ring: "ring-warning/30",     bg: "bg-warning/5",     text: "text-warning",     dot: "bg-warning",     label: "Revisar" },
                rechazado: { ring: "ring-destructive/30", bg: "bg-destructive/5", text: "text-destructive", dot: "bg-destructive", label: "No califica" },
              }[riesgoEval.semaforo];
              return (
                <div className={`rounded-xl border border-border bg-card p-4 ring-1 ring-inset ${meta.ring} ${meta.bg}`}>
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className={`inline-flex h-2.5 w-2.5 rounded-full ${meta.dot}`} />
                      <span className={`text-sm font-semibold ${meta.text}`}>Originación: {meta.label}</span>
                    </div>
                    <span className="text-[11px] text-muted-foreground">Score interno {riesgoEval.scoreInterno.categoria}</span>
                  </div>
                  <ul className="mt-2 space-y-1">
                    {riesgoEval.motivos.map((m, i) => (
                      <li key={i} className="flex gap-1.5 text-xs text-muted-foreground"><span className="text-muted-foreground/40">•</span>{m}</li>
                    ))}
                  </ul>
                  {/* Compromiso actual del cliente: créditos vivos + suma de sus cuotas mensuales
                      (esta deuda es la que reduce el monto que se le puede otorgar). */}
                  {riesgoEval.creditosActivos > 0 && (
                    <p className="mt-2 text-[11px] text-muted-foreground">
                      Ya tiene <span className="font-semibold text-foreground">{riesgoEval.creditosActivos}</span> crédito{riesgoEval.creditosActivos === 1 ? "" : "s"} vigente{riesgoEval.creditosActivos === 1 ? "" : "s"} · compromiso mensual <span className="font-mono font-semibold text-foreground">{formatMonto(riesgoEval.deudaCuotaMensualVigente)}</span>
                    </p>
                  )}
                  {/* Monto máximo sugerido por el sueldo del cliente (capacidad de pago). Botón para
                      cargarlo directo en el campo Capital. Solo si hay ingreso → hay número que sugerir.
                      Si el cliente NO CALIFICA (rechazado) NO se ofrece nada: sería incoherente sugerir
                      un préstamo a quien la política rechaza. Quedan solo los motivos + el aviso de bloqueo. */}
                  {!riesgoRechazado && (riesgoEval.montoMaximoSugerido > 0 ? (
                    <div className="mt-3 flex items-center justify-between gap-2 rounded-lg border border-primary/25 bg-primary/5 px-3 py-2">
                      <div>
                        <p className="text-[11px] text-muted-foreground">Monto máximo sugerido <span className="text-muted-foreground/70">· a {sim.plazo || formData.plazo_meses} cuotas</span></p>
                        <p className="font-mono text-sm font-bold text-foreground">{formatMonto(riesgoEval.montoMaximoSugerido)}</p>
                        <p className="text-[10px] text-muted-foreground/70">Cambia con el plazo: más cuotas → mayor monto (cuota más chica)</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => { setError(null); setFormData(p => ({ ...p, monto_original: numeroAInput(riesgoEval.montoMaximoSugerido) })); }}
                        className="shrink-0 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 transition-opacity"
                      >
                        Usar
                      </button>
                    </div>
                  ) : riesgoEval.ingresoNetoMensual <= 0 ? (
                    <p className="mt-3 rounded-lg bg-muted/30 px-3 py-2 text-[11px] text-muted-foreground">
                      Cargá el ingreso del cliente en su ficha para calcular el monto máximo sugerido.
                    </p>
                  ) : (
                    <p className="mt-3 rounded-lg border border-destructive/25 bg-destructive/5 px-3 py-2 text-[11px] text-destructive">
                      Sin margen para nuevo crédito: las cuotas de sus créditos vigentes ({formatMonto(riesgoEval.deudaCuotaMensualVigente)}/mes) ya superan su capacidad de pago ({formatMonto(riesgoEval.ingresoNetoMensual)} de ingreso).
                    </p>
                  ))}
                  <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
                    <div className="rounded-lg bg-muted/30 px-2.5 py-1.5">
                      <p className="text-muted-foreground">Cuota máx (capacidad)</p>
                      <p className="font-mono font-semibold text-foreground">{riesgoEval.capacidad.cuotaMaxima > 0 ? formatMonto(riesgoEval.capacidad.cuotaMaxima) : "—"}</p>
                    </div>
                    <div className="rounded-lg bg-muted/30 px-2.5 py-1.5">
                      <p className="text-muted-foreground">Ratio cuota / ingreso</p>
                      <p className="font-mono font-semibold text-foreground">{riesgoEval.ratioCuotaIngreso != null ? `${(riesgoEval.ratioCuotaIngreso * 100).toFixed(0)}%` : "—"}</p>
                    </div>
                  </div>
                  {riesgoRechazado && !riesgoEval.bloquea && esAdmin && (
                    <label className="mt-3 flex cursor-pointer items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2">
                      <input type="checkbox" checked={autorizarRiesgo} onChange={e => setAutorizarRiesgo(e.target.checked)} className="mt-0.5 accent-primary" />
                      <span className="text-xs text-foreground">Autorizo el otorgamiento asumiendo el riesgo (decisión del administrador).</span>
                    </label>
                  )}
                  {riesgoRechazado && !riesgoEval.bloquea && !esAdmin && (
                    <p className="mt-3 text-xs text-destructive">Requiere autorización de un administrador para otorgar.</p>
                  )}
                  {riesgoRechazado && riesgoEval.bloquea && (
                    <p className="mt-3 text-xs text-destructive">La política bloquea el otorgamiento a clientes que no califican.</p>
                  )}
                </div>
              );
            })()}
          </section>
        )}

        </div>{/* fin área scrolleable */}

        {/* Acciones — barra fija al fondo del panel, separada de la zona de carga */}
        <div className="shrink-0 flex items-center gap-2 justify-end border-t border-edge bg-muted/10 px-5 py-3.5">
          {/* Mobile: pasar a la vista del cronograma (en desktop se ven lado a lado) */}
          <button
            type="button" onClick={() => setCalcAbierta(false)}
            className="md:hidden mr-auto flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          >
            <ListOrdered className="h-4 w-4" /> Ver cuotas
          </button>
          <button
            type="button" onClick={() => onClose(false)}
            className="px-4 py-2 rounded-lg text-sm text-muted-foreground hover:bg-muted transition-colors"
          >
            Cancelar
          </button>
          <button
            type="submit" disabled={loading || fondosInsuficientes || riesgoImpide}
            title={fondosInsuficientes ? "Saldo insuficiente en la cuenta de desembolso" : riesgoImpide ? "El cliente no califica para este crédito" : undefined}
            className="px-5 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            {loading ? "Guardando..." : creditoId ? "Actualizar" : "Otorgar crédito"}
          </button>
        </div>
      </form>

      {/* ── DERECHA: plan de pagos ── */}
      <div className="relative flex-1 flex flex-col min-h-0 overflow-hidden">
        {/* Barra de progreso de recálculo — no ocupa layout, no choca con nada */}
        {calculando && (
          <div className="absolute top-0 inset-x-0 h-0.5 z-30 overflow-hidden">
            <div className="h-full w-1/3 bg-primary animate-[shimmer-sweep_1.1s_ease-in-out_infinite]" />
          </div>
        )}
        {/* Sub-header con toggle de vista */}
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-edge shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <button
              type="button"
              onClick={() => setCalcAbierta(v => !v)}
              title={calcAbierta ? "Ocultar la calculadora (ver cuotas a pantalla completa)" : "Mostrar la calculadora"}
              aria-label={calcAbierta ? "Ocultar calculadora" : "Mostrar calculadora"}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border text-muted-foreground hover:bg-muted hover:text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              {calcAbierta ? <PanelLeftClose className="h-4 w-4" /> : <PanelLeftOpen className="h-4 w-4" />}
            </button>
            <Emoji name="calendar" className="h-4 w-4 shrink-0" />
            <span className="text-sm font-semibold text-foreground whitespace-nowrap shrink-0">Plan de pagos</span>
            {plan && (
              <span className="text-[11px] font-mono bg-muted/60 text-muted-foreground rounded-full px-2 py-0.5 shrink-0 whitespace-nowrap">
                {plan.cuotas.length} {lbl.cuotaPlural}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {/* Toggle Operador / Cliente con cápsula deslizante */}
            <div className="relative flex items-center rounded-lg border border-border bg-muted/30 p-1">
              {([
                { key: "operador", label: "Operador", Icon: Eye },
                { key: "cliente",  label: "Cliente",  Icon: EyeOff },
              ] as const).map(({ key, label, Icon }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setVista(key)}
                  className={`relative flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-semibold transition-colors duration-200 ${
                    vista === key ? "text-foreground" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {vista === key && mounted && (
                    <motion.div
                      layoutId="vista-plan-capsule"
                      className="absolute inset-0 rounded-md bg-card shadow-sm border border-border/60"
                      transition={{ type: "spring", stiffness: 400, damping: 35 }}
                    />
                  )}
                  {vista === key && !mounted && (
                    <div className="absolute inset-0 rounded-md bg-card shadow-sm border border-border/60" />
                  )}
                  <span className="relative flex items-center gap-1.5" title={label}><Icon className="h-3.5 w-3.5" /> <span className="hidden sm:inline">{label}</span></span>
                </button>
              ))}
            </div>

            {/* Botón imprimir */}
            {plan && (
              <button
                type="button"
                onClick={() => imprimirPlan(vista)}
                title={`Imprimir vista ${vista}`}
                className="flex items-center gap-1.5 h-9 px-2.5 sm:px-3.5 rounded-lg border border-border bg-muted/30 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors shrink-0"
              >
                <Emoji name="printer" className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Imprimir</span>
              </button>
            )}
          </div>
        </div>

        {/* Aviso de la vista cliente */}
        {plan && vista === "cliente" && (
          <div className="flex items-center gap-1.5 px-5 py-2 text-[11px] text-muted-foreground/70 bg-muted/20 border-b border-border/60 shrink-0">
            <Info className="h-3 w-3 shrink-0" />
            Vista para el cliente: solo cuotas a cubrir, sin desglose de intereses.
          </div>
        )}

        {plan ? (
          <div className="relative flex-1 min-h-0">
            {/* Shimmer de recálculo — barrido suave mientras se recalcula el plan */}
            {calculando && (
              <div className="pointer-events-none absolute inset-0 z-20 overflow-hidden">
                <div className="absolute inset-y-0 left-0 w-1/4 bg-gradient-to-r from-transparent via-foreground/[0.06] to-transparent animate-[shimmer-sweep_1.1s_ease-in-out_infinite]" />
              </div>
            )}
            <div className={`h-full overflow-auto transition-opacity duration-200 ${calculando ? "opacity-50" : "opacity-100"}`}>
            {vista === "operador" ? (
              /* ── Vista operador: desglose completo ── */
              <table className="w-full text-xs border-separate border-spacing-0">
                <thead className="sticky top-0 z-10 bg-card">
                  <tr>
                    <th className="px-2.5 py-2.5 text-left font-semibold text-muted-foreground border-b border-border w-9">#</th>
                    <th className="px-2.5 py-2.5 text-left font-semibold text-muted-foreground border-b border-border">Vencimiento</th>
                    <th className="px-2.5 py-2.5 text-right font-semibold text-muted-foreground border-b border-border">Cuota</th>
                    <th className="px-2.5 py-2.5 text-right font-semibold text-warning border-b border-border">Interés</th>
                    <th className="px-2.5 py-2.5 text-right font-semibold text-primary border-b border-border">Capital</th>
                    {cargoCols.map(col => (
                      <th key={col.key} className="px-2.5 py-2.5 text-right font-semibold text-foreground bg-warning/5 border-b border-border align-bottom">{col.label}</th>
                    ))}
                    {hayCargoCols && <th className="px-2.5 py-2.5 text-right font-semibold text-foreground border-b border-border">Total</th>}
                    <th className="px-2.5 py-2.5 text-right font-semibold text-muted-foreground border-b border-border pr-3">Saldo</th>
                  </tr>
                </thead>
                <tbody>
                  {plan.cuotas.map((row, idx) => (
                    <tr key={row.nro} className={`hover:bg-muted/20 transition-colors ${idx % 2 === 1 ? "bg-muted/5" : ""}`}>
                      <td className="px-2.5 py-2 text-muted-foreground/50 font-mono tabular-nums">{row.nro}</td>
                      <td className="px-2.5 py-2 text-muted-foreground tabular-nums">{fmtDate(row.fecha)}</td>
                      <td className="px-2.5 py-2 text-right font-mono text-foreground tabular-nums">${n2(row.cuota)}</td>
                      <td className="px-2.5 py-2 text-right font-mono text-warning tabular-nums">${n2(row.interes)}</td>
                      <td className="px-2.5 py-2 text-right font-mono text-primary tabular-nums">${n2(row.capital)}</td>
                      {cargoCols.map(col => (
                        <td key={col.key} className="px-2.5 py-2 text-right font-mono text-foreground/80 bg-warning/5 tabular-nums">${n2(row[col.key])}</td>
                      ))}
                      {hayCargoCols && <td className="px-2.5 py-2 text-right font-mono font-semibold text-foreground tabular-nums">${n2(row.cuotaTotal)}</td>}
                      <td className="px-2.5 py-2 pr-3 text-right font-mono text-muted-foreground tabular-nums">${n2(row.saldo)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="sticky bottom-0 z-10 bg-card">
                  <tr className="border-t-2 border-border bg-muted/40">
                    <td colSpan={2} className="px-2.5 py-3.5 text-[10px] font-bold text-foreground uppercase tracking-widest">Totales</td>
                    <td className="px-2.5 py-3.5 text-right font-bold font-mono text-sm text-foreground tabular-nums">${n2(plan.totalPagado)}</td>
                    <td className="px-2.5 py-3.5 text-right font-bold font-mono text-sm text-warning tabular-nums">${n2(plan.totalIntereses)}</td>
                    <td className="px-2.5 py-3.5 text-right font-bold font-mono text-sm text-primary tabular-nums">${n2(montoNum)}</td>
                    {cargoCols.map(col => (
                      <td key={col.key} className="px-2.5 py-3.5 text-right font-bold font-mono text-sm text-foreground bg-warning/10 tabular-nums">${n2(col.key === "iva" ? plan.totalIva : col.key === "seguro" ? plan.totalSeguro : plan.totalGastos)}</td>
                    ))}
                    {hayCargoCols && <td className="px-2.5 py-3.5 text-right font-bold font-mono text-sm text-foreground tabular-nums">${n2(totalCuotasCliente)}</td>}
                    <td className="px-2.5 py-3.5 pr-3 text-right font-mono text-muted-foreground/30 tabular-nums">$ 0,00</td>
                  </tr>
                </tfoot>
              </table>
            ) : (
              /* ── Vista cliente: solo cuotas a cubrir ── */
              <table className="w-full text-sm border-separate border-spacing-0">
                <thead className="sticky top-0 z-10 bg-card">
                  <tr>
                    <th className="px-4 py-2.5 text-left font-semibold text-muted-foreground border-b border-border w-12">Cuota</th>
                    <th className="px-4 py-2.5 text-left font-semibold text-muted-foreground border-b border-border">Vence</th>
                    <th className="px-4 py-2.5 text-right font-semibold text-muted-foreground border-b border-border pr-6">A pagar</th>
                  </tr>
                </thead>
                <tbody>
                  {plan.cuotas.map((row, idx) => (
                    <tr key={row.nro} className={`hover:bg-muted/20 transition-colors ${idx % 2 === 1 ? "bg-muted/5" : ""}`}>
                      <td className="px-4 py-2.5 text-muted-foreground font-mono tabular-nums">{row.nro}/{plan.cuotas.length}</td>
                      <td className="px-4 py-2.5 text-foreground tabular-nums">{fmtDate(row.fecha)}</td>
                      <td className="px-4 py-2.5 pr-6 text-right font-mono font-semibold text-foreground tabular-nums">${n2(row.cuotaTotal)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="sticky bottom-0 z-10 bg-card">
                  <tr className="border-t-2 border-border bg-muted/40">
                    <td colSpan={2} className="px-4 py-3.5 text-[10px] font-bold text-foreground uppercase tracking-widest">Total a pagar</td>
                    <td className="px-4 py-3.5 pr-6 text-right font-bold font-mono text-base text-foreground tabular-nums">${n2(totalCuotasCliente)}</td>
                  </tr>
                </tfoot>
              </table>
            )}
            </div>{/* fin scroll tabla */}
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center gap-4 px-8 text-center">
            <div className="h-20 w-20 rounded-2xl bg-muted/20 border border-border/50 flex items-center justify-center">
              <Emoji name="calendar" className="h-9 w-9 opacity-40" />
            </div>
            <div className="space-y-1.5">
              <p className="text-sm font-semibold text-muted-foreground">Simulá el plan de pagos</p>
              <p className="text-xs text-muted-foreground/50 max-w-[280px] leading-relaxed">
                Completá capital, tasa, frecuencia y número de cuotas para ver el cronograma completo.
              </p>
            </div>
          </div>
        )}

        {/* ── Resumen financiero — barra horizontal al pie de la tabla ── */}
        {plan && (
          <div className={`shrink-0 border-t-2 border-border bg-card px-5 py-3 transition-opacity ${calculando ? "opacity-50" : "opacity-100"}`}>
            <div className="flex items-center gap-x-6 gap-y-3 flex-wrap">

              {/* Cuota principal */}
              <div className="flex items-center gap-2.5 shrink-0">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 border border-primary/20 shrink-0">
                  <Emoji name="chart-increasing" className="h-4 w-4" />
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground/80 leading-tight">
                    {lbl.cuotaSingular.charAt(0).toUpperCase() + lbl.cuotaSingular.slice(1)} {hayCargos ? "c/cargos" : "fija"} · Sist. Francés
                  </p>
                  <p className="text-xl font-bold text-foreground font-mono leading-tight">${n2(hayCargos ? plan.cuotaTotal : plan.cuota)}</p>
                </div>
              </div>

              <div className="h-9 w-px bg-border shrink-0" />

              {/* Stats */}
              <div className="flex items-center gap-5 shrink-0">
                <div>
                  <p className="text-[10px] text-muted-foreground leading-tight">Intereses</p>
                  <p className="text-sm font-bold text-warning font-mono leading-tight mt-0.5">${n0(plan.totalIntereses)}</p>
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground leading-tight">Total a pagar</p>
                  <p className="text-sm font-bold text-foreground font-mono leading-tight mt-0.5">${n0(hayCargos ? plan.totalConCargos : plan.totalPagado)}</p>
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground leading-tight">T.E.A.</p>
                  <p className="text-sm font-bold text-foreground font-mono leading-tight mt-0.5">{tasaEA > 0 ? `${n2(tasaEA * 100)}%` : "—"}</p>
                </div>
                {hayCargos && (
                  <div>
                    <p className="text-[10px] text-muted-foreground leading-tight">Cargos totales</p>
                    <p className="text-sm font-bold text-foreground font-mono leading-tight mt-0.5">${n0(plan.totalCargos)}</p>
                  </div>
                )}
              </div>

              {/* Barra capital vs interés — ocupa el resto */}
              <div className="flex-1 min-w-[180px]">
                <div className="flex justify-between text-[10px] mb-1">
                  <span className="text-primary font-semibold">Capital {capPct}%</span>
                  <span className="text-warning font-semibold">Interés {100 - capPct}%</span>
                </div>
                <div className="h-1 rounded-full bg-warning/40 overflow-hidden">
                  <div className="h-full bg-primary rounded-full transition-all duration-300" style={{ width: `${capPct}%` }} />
                </div>
              </div>

            </div>
          </div>
        )}
      </div>
    </div>

    {/* Alta rápida de cliente (cuando el DNI buscado no existe) */}
    <Dialog open={alta.open} onOpenChange={open => { if (!open) handleAltaClose(false); }}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Nuevo cliente</DialogTitle>
        </DialogHeader>
        <ClienteForm initialDocumento={alta.doc} onClose={handleAltaClose} />
      </DialogContent>
    </Dialog>

    {/* Aviso de confirmación previo al otorgamiento */}
    <AlertDialog open={confirmOpen} onOpenChange={(o) => { if (!loading) setConfirmOpen(o); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>¿Otorgar el crédito a {clienteSel ? nombreCompleto(clienteSel) : "este cliente"}?</AlertDialogTitle>
          <AlertDialogDescription>
            Revisá los datos. Al confirmar se otorga el crédito y se registra el desembolso en caja.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="space-y-2.5 rounded-xl border border-border bg-card p-4">
          <DetalleRow label="Cliente" value={clienteSel ? nombreCompleto(clienteSel) : "—"} />
          {clienteSel?.documento && <DetalleRow label="DNI" value={clienteSel.documento} mono />}
          <div className="border-t border-border" />
          <DetalleRow label="Capital" value={formatMonto(montoNum)} mono strong />
          {plan && <DetalleRow label={`Cuota (${lbl.cuotaSingular})`} value={formatMonto(hayCargos ? plan.cuotaTotal : plan.cuota)} mono />}
          {plan && <DetalleRow label="Plan" value={`${plan.cuotas.length} ${lbl.cuotaPlural}`} />}
          {plan && <DetalleRow label="Total a pagar" value={formatMonto(hayCargos ? totalCuotasCliente : plan.totalPagado)} mono strong />}
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={loading}>Cancelar</AlertDialogCancel>
          <button
            type="button"
            onClick={persist}
            disabled={loading}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-primary px-5 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {loading ? "Otorgando..." : "Confirmar y otorgar"}
          </button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  );
}

/**
 * Buscador de cliente para el otorgamiento: filtra por DNI (normalizando dígitos)
 * o por apellido y nombre. Reemplaza el viejo desplegable de opciones.
 */
function ClienteCombobox({ clientes, value, onSelect, onAlta }: {
  clientes: Cliente[]; value: string; onSelect: (id: string) => void; onAlta: (query: string) => void;
}) {
  const [query, setQuery] = useState("");
  // `searched` = término efectivamente buscado (al tocar la lupa). null = nada buscado aún.
  const [searched, setSearched] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [verTodos, setVerTodos] = useState(false); // F3: lista completa de clientes A→Z
  const selected = clientes.find(c => c.id === value) ?? null;

  // Resultados sobre el término BUSCADO (no mientras se tipea).
  const results = useMemo(() => {
    if (!searched) return [];
    const s = searched.toLowerCase();
    const sd = s.replace(/\D/g, "");
    return clientes.filter(c => {
      const nombre = nombreCompleto(c).toLowerCase();
      const doc = (c.documento || "").toLowerCase();
      const docd = doc.replace(/\D/g, "");
      return nombre.includes(s) || doc.includes(s) || (sd.length > 0 && docd.includes(sd));
    }).slice(0, 8);
  }, [clientes, searched]);

  // Lista completa ordenada (para "ver todos" con F3).
  const clientesOrdenados = useMemo(
    () => [...clientes].sort((a, b) => nombreCompleto(a).localeCompare(nombreCompleto(b), "es", { sensitivity: "base" })).slice(0, 200),
    [clientes],
  );
  const lista = verTodos ? clientesOrdenados : results;

  const doSearch = () => {
    const t = query.trim();
    if (!t) { setSearched(null); setOpen(false); return; }
    setSearched(t);
    setOpen(true);
  };
  const pick = (c: Cliente) => { onSelect(c.id); setQuery(""); setSearched(null); setOpen(false); setVerTodos(false); };
  const lanzarAlta = () => { onAlta(searched ?? query.trim()); setQuery(""); setSearched(null); setOpen(false); setVerTodos(false); };

  if (selected) {
    return (
      <div className="flex h-10 items-center justify-between gap-2 rounded-lg border border-border bg-muted/40 px-3">
        <span className="truncate text-sm text-foreground">
          {nombreCompleto(selected)}
          {selected.documento && <span className="text-muted-foreground"> · DNI {selected.documento}</span>}
        </span>
        <button
          type="button"
          onClick={() => { onSelect(""); setQuery(""); setSearched(null); }}
          title="Cambiar cliente"
          className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  return (
    <div className="relative">
      {/* Campo único: input con la lupa integrada a la derecha (acción de buscar). */}
      <div className="group relative flex h-10 items-center rounded-lg border border-border bg-muted/40 transition-all focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20">
        <input
          type="text"
          autoComplete="off"
          placeholder="Ingresá DNI o apellido y nombre…"
          value={query}
          // Al editar, se ocultan resultados previos hasta volver a buscar con la lupa.
          onChange={e => { setQuery(e.target.value); setSearched(null); setOpen(false); setVerTodos(false); }}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={e => {
            if (e.key === "F3") { e.preventDefault(); setVerTodos(true); setSearched(null); setOpen(true); return; }
            if (e.key === "Enter") { e.preventDefault(); doSearch(); return; }
            if (e.key === "Escape") { setOpen(false); setVerTodos(false); }
          }}
          className="h-full flex-1 rounded-lg bg-transparent pl-3 pr-1 text-sm text-foreground placeholder:text-muted-foreground/40 outline-none"
        />
        <button
          type="button"
          onClick={doSearch}
          onMouseDown={e => e.preventDefault()}
          title="Buscar cliente"
          aria-label="Buscar cliente"
          className="mr-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-background hover:text-primary"
        >
          <Search className="h-4 w-4" />
        </button>
      </div>

      <p className="mt-1 text-[10px] text-muted-foreground/50">
        Tip: <kbd className="rounded border border-border bg-muted/50 px-1 py-0.5 font-mono text-[9px] font-semibold">F3</kbd> para ver todos los clientes.
      </p>

      {open && (searched !== null || verTodos) && (
        <div className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-border bg-card shadow-lg">
          {lista.length > 0 ? (
            <>
              {verTodos && (
                <p className="px-2.5 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/50">
                  Todos los clientes · orden alfabético
                </p>
              )}
              {lista.map(c => (
                <button
                  key={c.id}
                  type="button"
                  onMouseDown={e => e.preventDefault()}
                  onClick={() => pick(c)}
                  className="flex w-full items-center justify-between gap-2 px-2.5 py-2 text-left hover:bg-muted/50 transition-colors"
                >
                  <span className="truncate text-sm text-foreground">{nombreCompleto(c)}</span>
                  <span className="shrink-0 font-mono text-xs text-muted-foreground">{c.documento || "—"}</span>
                </button>
              ))}
            </>
          ) : verTodos ? (
            <p className="px-2.5 py-2.5 text-xs text-muted-foreground/60">No hay clientes cargados.</p>
          ) : (
            /* Sin coincidencias → el cliente no existe → ofrecer alta. */
            <>
              <p className="px-2.5 py-2.5 text-xs text-muted-foreground/60">
                «{searched}» no pertenece a ningún cliente.
              </p>
              <button
                type="button"
                onMouseDown={e => e.preventDefault()}
                onClick={lanzarAlta}
                className="flex w-full items-center gap-2 border-t border-border px-2.5 py-2.5 text-left text-sm text-primary hover:bg-primary/5 transition-colors"
              >
                <UserPlus className="h-3.5 w-3.5 shrink-0" />
                Dar de alta nuevo cliente · «{searched}»
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** Fila etiqueta/valor del detalle del aviso de confirmación. */
function DetalleRow({ label, value, mono, strong }: { label: string; value: string; mono?: boolean; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className={`${mono ? "font-mono" : ""} ${strong ? "font-semibold" : ""} truncate text-foreground`}>{value}</span>
    </div>
  );
}

function CargoLinea({ label, valor }: { label: string; valor: number }) {
  return (
    <div className="flex justify-between text-[11px]">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-foreground font-mono">${n2(valor)}</span>
    </div>
  );
}
