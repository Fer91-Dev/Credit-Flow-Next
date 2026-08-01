"use client";

/**
 * Diálogos del **agente**: alta/edición de su ficha (`PersonalForm`) y creación de la
 * cuenta de acceso de un agente que todavía no la tiene (`CrearCuentaDialog`).
 *
 * Salieron de la pantalla "Agentes" (`PersonalView`) cuando esa sección se apagó en la
 * etapa 3 del refactor de Equipo. NO son copias: es el mismo código, movido tal cual —
 * el alta atómica (cuenta de Auth + profile + ficha, con rollback) sigue siendo la
 * original y nunca se duplicó.
 */

import { useState } from "react";
import { type Vendedor } from "@/lib/swr";
import { Emoji } from "@/components/ui/Emoji";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input, Select, PasswordFields } from "@/components/ui/field";
import { UsernameField } from "@/components/ui/UsernameField";
import { ModalHeader, MoneyInput, FormActions, MODAL_CONTENT } from "@/components/ui/form-kit";
import { parseMontoInput, numeroAInput, soloDigitos, esEmailValido, esUsernameValido, normalizarUsername } from "@/lib/utils";
import { useConfirm } from "@/components/ui/confirm";
import { useToast } from "@/components/ui/toast";

export function PersonalForm({
  open, vendedor, onClose,
}: {
  open: boolean;
  vendedor: Vendedor | null;
  onClose: (ok?: boolean) => void;
}) {
  const confirm = useConfirm();
  const toast = useToast();
  const editing = !!vendedor;
  const [nombre, setNombre] = useState("");
  const [apellido, setApellido] = useState("");
  const [email, setEmail] = useState("");
  const [telefono, setTelefono] = useState("");
  const [rol, setRol] = useState<Vendedor["rol"]>("vendedor");
  const [comision, setComision] = useState("0");
  const [meta, setMeta] = useState("");
  const [activo, setActivo] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Cuenta de acceso (solo alta) — OBLIGATORIA: todo agente nuevo debe poder loguearse.
  const [cuentaPassword, setCuentaPassword] = useState("");
  const [cuentaPasswordConfirm, setCuentaPasswordConfirm] = useState("");
  const [cuentaUsername, setCuentaUsername] = useState("");
  const [cuentaUsernameOk, setCuentaUsernameOk] = useState(false);
  const [rolAcceso, setRolAcceso] = useState<"vendedor" | "cobrador" | "admin">("vendedor");

  // Sincroniza el formulario cuando se abre para editar o crear.
  const [syncKey, setSyncKey] = useState<string | null>(null);
  const currentKey = open ? (vendedor?.id ?? "new") : null;
  if (currentKey !== syncKey) {
    setSyncKey(currentKey);
    // `vendedores.nombre` guarda el compuesto ("Juan Pérez"). Para precargar los dos
    // campos se corta en el PRIMER espacio: el resto es apellido (soporta apellidos
    // compuestos, "Juan De la Fuente" -> nombre "Juan", apellido "De la Fuente").
    {
      const completo = (vendedor?.nombre ?? "").trim();
      const corte = completo.indexOf(" ");
      setNombre(corte === -1 ? completo : completo.slice(0, corte));
      setApellido(corte === -1 ? "" : completo.slice(corte + 1));
    }
    setEmail(vendedor?.email ?? "");
    setTelefono(vendedor?.telefono ?? "");
    setRol(vendedor?.rol ?? "vendedor");
    setComision(String(vendedor?.comision_pct ?? 0));
    setMeta(vendedor?.meta_venta ? numeroAInput(vendedor.meta_venta) : "");
    setActivo(vendedor?.activo ?? true);
    setCuentaPassword("");
    setCuentaPasswordConfirm("");
    setCuentaUsername("");
    setCuentaUsernameOk(false);
    setRolAcceso("vendedor");
    setError(null);
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nombre.trim()) { setError("El nombre es requerido"); return; }
    // Alta: la cuenta de acceso es obligatoria (el agente necesita loguearse para trabajar).
    if (!editing) {
      if (!email.trim()) { setError("El email es requerido: es el usuario de acceso del agente"); return; }
      if (!esEmailValido(email)) { setError("Email inválido (ej. nombre@correo.com)"); return; }
      if (cuentaPassword.length < 8) { setError("La contraseña de acceso debe tener al menos 8 caracteres"); return; }
      if (cuentaPassword !== cuentaPasswordConfirm) { setError("Las contraseñas no coinciden"); return; }
      if (!cuentaUsername.trim()) { setError("El nombre de usuario es requerido"); return; }
      if (!esUsernameValido(cuentaUsername)) {
        setError("Usuario inválido: 3–30 caracteres, letras/números y . _ - (sin @ ni espacios)");
        return;
      }
    }
    const ok = await confirm({
      title: editing ? "¿Guardar cambios?" : "¿Crear agente?",
      description: editing
        ? `Se actualizarán los datos de ${nombre.trim()}.`
        : `Se creará el agente ${nombre.trim()} con su cuenta de acceso (${email.trim()}).`,
      confirmLabel: editing ? "Guardar cambios" : "Crear",
    });
    if (!ok) return;
    setLoading(true); setError(null);
    try {
      const body: Record<string, unknown> = {
        nombre, apellido, email, telefono, rol,
        comision_pct: parseFloat(comision) || 0,
        meta_venta: parseMontoInput(meta),
        activo,
      };
      if (!editing) {
        body.crear_cuenta = {
          email: email.trim(),
          password: cuentaPassword,
          rol_acceso: rolAcceso,
          username: cuentaUsername.trim() ? normalizarUsername(cuentaUsername) : null,
        };
      }
      const enviar = async (extra?: Record<string, unknown>) => {
        const res = await fetch(editing ? `/api/vendedores/${vendedor!.id}` : "/api/vendedores", {
          method: editing ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...body, ...extra }),
        });
        return res.json();
      };

      let json = await enviar();

      // Opción B: el email ya tiene una cuenta huérfana (de un agente eliminado) → ofrecer vincularla.
      if (!json.ok && json.code === "EMAIL_VINCULABLE") {
        const vincular = await confirm({
          title: "Ese email ya tiene una cuenta",
          description: `Existe una cuenta con ${email.trim()} sin agente asociado (quedó de un agente eliminado). ¿Vincularla a ${nombre.trim()}? Se le asignará la contraseña que ingresaste.`,
          confirmLabel: "Vincular la cuenta",
        });
        if (!vincular) { setLoading(false); return; }
        json = await enviar({ vincular_existente: true });
      }

      if (json.ok) {
        if (json.data?.cuenta_vinculada) {
          toast.success(`${nombre.trim()} creado vinculando la cuenta ${json.data.cuenta_email}`);
        } else if (json.data?.cuenta_creada) {
          toast.success(`${nombre.trim()} creado con cuenta de acceso (${json.data.cuenta_email})`);
        } else {
          toast.success(editing ? `${nombre.trim()} actualizado` : `${nombre.trim()} creado`);
        }
        onClose(true);
      } else setError(json.error);
    } catch {
      setError("No se pudo guardar");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(false); }}>
      <DialogContent className={MODAL_CONTENT}>
        <ModalHeader
          icon="office-worker"
          title={editing ? "Editar agente" : "Nuevo agente"}
          subtitle={editing ? "Actualizá los datos del agente." : "Sumá un integrante al equipo de ventas y cobranza."}
        />
        <form onSubmit={submit} className="space-y-4">
          {error && (
            <div className="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2.5 text-sm text-destructive">{error}</div>
          )}
          {/* Nombre y apellido SEPARADOS, igual que en Clientes y en Mi perfil. En un
              solo input, el agente despues veia todo junto en el campo "Nombre" de su
              perfil, con "Apellido" vacio. */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Nombre" required>
              <Input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Ej: Juan" required />
            </Field>
            <Field label="Apellido">
              <Input value={apellido} onChange={(e) => setApellido(e.target.value)} placeholder="Ej: Pérez" />
            </Field>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Email" required={!editing} hint={editing ? undefined : "Email real del agente — se usa para ingresar y para recuperar la contraseña"}>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={editing ? "opcional" : "nombre@email-real.com"} required={!editing} />
            </Field>
            <Field label="Teléfono">
              <Input value={telefono} inputMode="numeric" onChange={(e) => setTelefono(soloDigitos(e.target.value, 10))} placeholder="10 dígitos (opcional)" />
            </Field>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* El "Rol" del legajo se quitó: `vendedores.rol` está DEPRECADO — no
                controla ningún permiso (eso es `profiles.role`) y solo alimentaba un
                badge. Tenerlo acá hacía que el formulario pidiera el rol DOS veces,
                y el de arriba no hacía nada. El único rol real es "Rol de acceso",
                más abajo, en la sección de cuenta. */}
            <Field label="Comisión (%)" hint="sobre el monto otorgado">
              <Input type="number" min="0" max="100" step="any" value={comision} onChange={(e) => setComision(e.target.value)} className="font-mono tabular-nums" />
            </Field>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Meta de venta" hint="vacío = sin meta">
              <MoneyInput value={meta} onChange={setMeta} />
            </Field>
            <Field label="Estado">
              <Select value={activo ? "activo" : "inactivo"} onChange={(e) => setActivo(e.target.value === "activo")}>
                <option value="activo">Activo</option>
                <option value="inactivo">Inactivo</option>
              </Select>
            </Field>
          </div>
          {/* Cuenta de acceso — OBLIGATORIA en alta (el agente necesita loguearse para trabajar) */}
          {!editing && (
            <div className="rounded-lg border border-border bg-muted/20 overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-3 text-sm font-medium text-foreground border-b border-border">
                <Emoji name="locked-with-key" className="h-4 w-4 shrink-0" />
                <span>Cuenta de acceso al sistema</span>
                <span className="text-[10px] font-semibold uppercase tracking-wide text-primary bg-primary/10 rounded-full px-2 py-0.5">Requerida</span>
              </div>
              <div className="px-4 pb-4 pt-3 space-y-3">
                <p className="text-[11px] text-muted-foreground">
                  El agente inicia sesión con el <strong>email</strong> de arriba y la contraseña que definas acá. Sin cuenta no podría acceder al sistema para trabajar.
                </p>
                <PasswordFields
                  label="Contraseña de acceso"
                  password={cuentaPassword}
                  confirm={cuentaPasswordConfirm}
                  onPassword={setCuentaPassword}
                  onConfirm={setCuentaPasswordConfirm}
                  required
                />
                <UsernameField value={cuentaUsername} onChange={setCuentaUsername} onValidChange={setCuentaUsernameOk} />
                <Field label="Rol de acceso" required>
                  <Select value={rolAcceso} onChange={(e) => setRolAcceso(e.target.value as typeof rolAcceso)}>
                    <option value="vendedor">Vendedor</option>
                    <option value="admin">Administrador</option>
                  </Select>
                </Field>
              </div>
            </div>
          )}

          <FormActions
            onCancel={() => onClose(false)}
            loading={loading}
            disabled={!nombre.trim() || (!editing && (!email.trim() || !cuentaUsernameOk || cuentaPassword.length < 8 || cuentaPassword !== cuentaPasswordConfirm))}
            submitLabel={editing ? "Guardar cambios" : "Crear"}
          />
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Diálogo rápido para crear la cuenta de acceso de un agente que quedó sin ella
 * (agentes viejos, previos a la regla de cuenta obligatoria). Crea el profile de login
 * vía POST /api/usuarios vinculado al vendedor.
 */
export function CrearCuentaDialog({ vendedor, onClose }: { vendedor: Vendedor | null; onClose: (ok?: boolean) => void }) {
  const confirm = useConfirm();
  const toast = useToast();
  const open = !!vendedor;

  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [usernameOk, setUsernameOk] = useState(false);
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [rolAcceso, setRolAcceso] = useState<"vendedor" | "cobrador" | "admin">("vendedor");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sincroniza al abrir con cada agente distinto.
  const [syncKey, setSyncKey] = useState<string | null>(null);
  const currentKey = open ? vendedor!.id : null;
  if (currentKey !== syncKey) {
    setSyncKey(currentKey);
    setEmail(vendedor?.email ?? "");
    setUsername("");
    setUsernameOk(false);
    setPassword("");
    setPasswordConfirm("");
    setRolAcceso("vendedor");
    setError(null);
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!vendedor) return;
    if (!email.trim()) { setError("El email es requerido"); return; }
    if (!esEmailValido(email)) { setError("Email inválido (ej. nombre@correo.com)"); return; }
    if (password.length < 8) { setError("La contraseña debe tener al menos 8 caracteres"); return; }
    if (password !== passwordConfirm) { setError("Las contraseñas no coinciden"); return; }
    if (!username.trim()) { setError("El nombre de usuario es requerido"); return; }
    if (!esUsernameValido(username)) {
      setError("Usuario inválido: 3–30 caracteres, letras/números y . _ - (sin @ ni espacios)");
      return;
    }
    const ok = await confirm({
      title: "¿Crear cuenta de acceso?",
      description: `Se creará el acceso de ${vendedor.nombre} (${email.trim()}) con rol ${rolAcceso}.`,
      confirmLabel: "Crear cuenta",
    });
    if (!ok) return;
    setLoading(true); setError(null);
    try {
      const res = await fetch("/api/usuarios", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim(),
          password,
          full_name: vendedor.nombre,
          role: rolAcceso,
          username: username.trim() ? normalizarUsername(username) : null,
          vendedor_id: rolAcceso === "vendedor" ? vendedor.id : null,
        }),
      });
      const json = await res.json();
      if (json.ok) {
        toast.success(`Cuenta de acceso creada para ${vendedor.nombre}`);
        onClose(true);
      } else setError(json.error);
    } catch {
      setError("No se pudo crear la cuenta");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(false); }}>
      <DialogContent className={MODAL_CONTENT}>
        <ModalHeader
          icon="locked-with-key"
          title="Crear cuenta de acceso"
          subtitle={vendedor ? `Dale acceso al sistema a ${vendedor.nombre}.` : ""}
        />
        <form onSubmit={submit} className="space-y-4">
          {error && (
            <div className="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2.5 text-sm text-destructive">{error}</div>
          )}
          <Field label="Email" required hint="Email real del agente — se usa para ingresar y para recuperar la contraseña">
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="nombre@email-real.com" required />
          </Field>
          <UsernameField value={username} onChange={setUsername} onValidChange={setUsernameOk} />
          <PasswordFields
            label="Contraseña de acceso"
            password={password}
            confirm={passwordConfirm}
            onPassword={setPassword}
            onConfirm={setPasswordConfirm}
            required
          />
          <Field label="Rol de acceso" required hint="'Vendedor' se vincula a esta ficha de agente">
            <Select value={rolAcceso} onChange={(e) => setRolAcceso(e.target.value as typeof rolAcceso)}>
              <option value="vendedor">Vendedor</option>
              <option value="admin">Administrador</option>
            </Select>
          </Field>
          <FormActions
            onCancel={() => onClose(false)}
            loading={loading}
            disabled={!email.trim() || !usernameOk || password.length < 8 || password !== passwordConfirm}
            submitLabel="Crear cuenta"
          />
        </form>
      </DialogContent>
    </Dialog>
  );
}

