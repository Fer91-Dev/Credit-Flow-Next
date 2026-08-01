"use client";

/**
 * Diálogos de la **cuenta de acceso**: alta/edición del login (`UsuarioForm`) y cambio
 * de contraseña por el admin (`CambiarPasswordDialog`).
 *
 * Salieron de la pantalla "Usuarios" (`UsuariosView`) cuando esa sección se apagó en la
 * etapa 3 del refactor de Equipo. NO son copias: es el mismo código, movido tal cual.
 */

import { useState } from "react";
import { useVendedores, KEYS, type Usuario, type RolUsuario } from "@/lib/swr";
import { esEmailValido, esUsernameValido, normalizarUsername } from "@/lib/utils";
import { mutate as globalMutate } from "swr";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Field, Input, Select, PasswordFields } from "@/components/ui/field";
import { UsernameField } from "@/components/ui/UsernameField";
import { ModalHeader, FormActions, MODAL_CONTENT } from "@/components/ui/form-kit";
import { useConfirm } from "@/components/ui/confirm";
import { useToast } from "@/components/ui/toast";

export function UsuarioForm({
  open, usuario, onClose, linkedVendedorIds,
}: {
  open: boolean;
  usuario: Usuario | null;
  onClose: (ok?: boolean) => void;
  linkedVendedorIds: Set<string>;
}) {
  const editing = !!usuario;
  const { vendedores } = useVendedores();
  const confirm = useConfirm();
  const toast = useToast();

  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [usernameOk, setUsernameOk] = useState(false);
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [nombre, setNombre] = useState("");
  const [apellido, setApellido] = useState("");
  const [role, setRole] = useState<RolUsuario>("vendedor");
  const [vendedorId, setVendedorId] = useState("");
  const [activo, setActivo] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sincroniza el formulario al abrir (crear vs editar).
  const [syncKey, setSyncKey] = useState<string | null>(null);
  const currentKey = open ? (usuario?.id ?? "new") : null;
  if (currentKey !== syncKey) {
    setSyncKey(currentKey);
    setEmail(usuario?.email ?? "");
    setUsername(usuario?.username ?? "");
    setUsernameOk(false);
    setPassword("");
    setPasswordConfirm("");
    setRole((usuario?.role as RolUsuario) ?? "vendedor");
    setVendedorId(usuario?.vendedor_id ?? "");
    // `full_name` está guardado compuesto: se corta en el PRIMER espacio (el resto es
    // apellido, para soportar apellidos compuestos: "Juan De la Fuente").
    {
      const completo = (usuario?.full_name ?? "").trim();
      const corte = completo.indexOf(" ");
      setNombre(corte === -1 ? completo : completo.slice(0, corte));
      setApellido(corte === -1 ? "" : completo.slice(corte + 1));
    }
    setActivo(usuario?.activo ?? true);
    setError(null);
  }

  const vendedoresActivos = vendedores.filter((v) => v.activo);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!email.trim()) { setError("El email es requerido"); return; }
    if (!esEmailValido(email)) { setError("Email inválido (ej. nombre@correo.com)"); return; }
    if (!editing) {
      if (password.length < 8) { setError("La contraseña debe tener al menos 8 caracteres"); return; }
      if (password !== passwordConfirm) { setError("Las contraseñas no coinciden"); return; }
    }
    if (!username.trim()) { setError("El nombre de usuario es requerido"); return; }
    if (!esUsernameValido(username)) {
      setError("Usuario inválido: 3–30 caracteres, letras/números y . _ - (sin @ ni espacios)");
      return;
    }
    if (role === "vendedor" && !vendedorId) {
      setError("Un usuario con rol vendedor debe vincularse a una ficha de agente (para tener su propia caja).");
      return;
    }
    const ok = await confirm({
      title: editing ? "¿Guardar cambios?" : "¿Crear usuario?",
      description: editing
        ? `Se actualizará el acceso de ${usuario!.email}.`
        : `Se creará el acceso para ${email.trim()} con rol ${role}.`,
      confirmLabel: editing ? "Guardar cambios" : "Crear usuario",
    });
    if (!ok) return;
    setLoading(true);
    try {
      const vinc = role === "vendedor" && vendedorId ? vendedorId : null;
      const usuarioAlias = username.trim() ? normalizarUsername(username) : null;
      const res = editing
        ? await fetch(`/api/usuarios/${usuario!.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email: email.trim(), nombre, apellido, role, activo, vendedor_id: vinc, username: usuarioAlias }),
          })
        : await fetch("/api/usuarios", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, password, nombre, apellido, role, vendedor_id: vinc, username: usuarioAlias }),
          });
      const json = await res.json();
      if (json.ok) {
        globalMutate(KEYS.usuarios);
        toast.success(editing ? "Usuario actualizado" : `Usuario ${email.trim()} creado`);
        onClose(true);
      } else {
        setError(json.error);
      }
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
          icon="locked-with-key"
          title={editing ? "Editar usuario" : "Nuevo usuario"}
          subtitle={editing ? "Actualizá el acceso y el rol del usuario." : "Creá un acceso de login y asignale un rol."}
        />
        <form onSubmit={submit} className="space-y-4">
          {error && (
            <div className="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2.5 text-sm text-destructive">{error}</div>
          )}

          <Field label="Email" required hint={editing ? "Cambiarlo actualiza el email de login del usuario" : "Email real del usuario — se usa para ingresar y para recuperar la contraseña"}>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="nombre@email-real.com"
              required
            />
          </Field>

          {!editing && (
            <PasswordFields
              label="Contraseña temporal"
              password={password}
              confirm={passwordConfirm}
              onPassword={setPassword}
              onConfirm={setPasswordConfirm}
              required
            />
          )}

          {/* Separados, igual que en Clientes, Mi perfil y el alta de agente. En un
              solo input, la persona despues veia todo junto en el campo "Nombre" de su
              perfil. `full_name` lo recalcula el server como el compuesto. */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Nombre">
              <Input value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Ej: Juan" />
            </Field>
            <Field label="Apellido">
              <Input value={apellido} onChange={(e) => setApellido(e.target.value)} placeholder="Ej: Pérez" />
            </Field>
          </div>

          <UsernameField value={username} onChange={setUsername} excludeId={usuario?.id} onValidChange={setUsernameOk} />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Rol" required>
              <Select value={role} onChange={(e) => setRole(e.target.value as RolUsuario)}>
                <option value="admin">Administrador</option>
                <option value="vendedor">Vendedor</option>
              </Select>
            </Field>
            {editing && (
              <Field label="Estado">
                <Select value={activo ? "activo" : "inactivo"} onChange={(e) => setActivo(e.target.value === "activo")}>
                  <option value="activo">Activo</option>
                  <option value="inactivo">Inactivo</option>
                </Select>
              </Field>
            )}
          </div>

          {role === "vendedor" && (() => {
            const hayDisponibles = vendedoresActivos.some(
              (v) => !linkedVendedorIds.has(v.id) || v.id === usuario?.vendedor_id,
            );
            return (
              <Field
                label="Vincular a su ficha de agente"
                required
                hint="Un vendedor necesita ficha de agente: es donde se enganchan sus créditos, su comisión, su meta y su caja"
              >
                <Select value={vendedorId} onChange={(e) => setVendedorId(e.target.value)} required>
                  <option value="">— elegí un agente —</option>
                  {vendedoresActivos.map((v) => {
                    // Deshabilitar los que ya tienen cuenta, salvo el vinculado a ESTE usuario.
                    const yaVinculado = linkedVendedorIds.has(v.id) && v.id !== usuario?.vendedor_id;
                    return (
                      <option key={v.id} value={v.id} disabled={yaVinculado}>
                        {v.nombre}{yaVinculado ? " — ya tiene cuenta" : ""}
                      </option>
                    );
                  })}
                </Select>
                {!hayDisponibles && (
                  <p className="mt-1.5 text-xs text-warning">
                    No hay fichas de agente libres. Creá al vendedor directamente desde <strong>Agentes</strong> (ya incluye su cuenta de acceso).
                  </p>
                )}
              </Field>
            );
          })()}

          <FormActions
            onCancel={() => onClose(false)}
            loading={loading}
            disabled={!usernameOk || (role === "vendedor" && !vendedorId)}
            submitLabel={editing ? "Guardar cambios" : "Crear usuario"}
          />
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Mini-modal para que el admin cambie la contraseña de un usuario (sin recrearlo). */
export function CambiarPasswordDialog({ usuario, onClose }: { usuario: Usuario | null; onClose: () => void }) {
  const confirm = useConfirm();
  const toast = useToast();
  const open = !!usuario;

  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [syncKey, setSyncKey] = useState<string | null>(null);
  const currentKey = open ? usuario!.id : null;
  if (currentKey !== syncKey) {
    setSyncKey(currentKey);
    setPassword("");
    setPasswordConfirm("");
    setError(null);
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!usuario) return;
    if (password.length < 8) { setError("La contraseña debe tener al menos 8 caracteres"); return; }
    if (password !== passwordConfirm) { setError("Las contraseñas no coinciden"); return; }
    const ok = await confirm({
      title: "¿Cambiar contraseña?",
      description: `Se cambiará la contraseña de acceso de ${usuario.email}. La sesión activa del usuario sigue abierta; la nueva clave aplica en su próximo ingreso.`,
      confirmLabel: "Cambiar contraseña",
    });
    if (!ok) return;
    setLoading(true); setError(null);
    try {
      const res = await fetch(`/api/usuarios/${usuario.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const json = await res.json();
      if (json.ok) {
        toast.success(`Contraseña de ${usuario.email} actualizada`);
        onClose();
      } else setError(json.error);
    } catch {
      setError("No se pudo cambiar la contraseña");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className={MODAL_CONTENT}>
        <ModalHeader
          icon="locked-with-key"
          title="Cambiar contraseña"
          subtitle={usuario ? `Nueva contraseña de acceso para ${usuario.email}.` : ""}
        />
        <form onSubmit={submit} className="space-y-4">
          {error && (
            <div className="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2.5 text-sm text-destructive">{error}</div>
          )}
          <PasswordFields
            label="Nueva contraseña"
            password={password}
            confirm={passwordConfirm}
            onPassword={setPassword}
            onConfirm={setPasswordConfirm}
            required
          />
          <FormActions
            onCancel={onClose}
            loading={loading}
            disabled={password.length < 8 || password !== passwordConfirm}
            submitLabel="Cambiar contraseña"
          />
        </form>
      </DialogContent>
    </Dialog>
  );
}

