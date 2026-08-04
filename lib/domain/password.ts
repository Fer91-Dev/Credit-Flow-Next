/**
 * Política de contraseñas (OWASP A07).
 *
 * Criterio: **largo y "no adivinable" antes que complejidad de símbolos.** Las reglas de
 * composición ("una mayúscula, un número, un símbolo") empujan a la gente a
 * `Password1!` — que cumple todo y es de las primeras que prueba cualquier atacante. Por
 * eso acá no se exige composición: se exige largo mínimo y se rechaza lo que ya se sabe
 * que se prueba primero.
 *
 * Dominio PURO: la usan el servidor (barrera real) y el formulario (aviso en vivo). Que
 * sea la MISMA función evita el caso peor — que la UI acepte algo que el backend rechaza,
 * o al revés, que la UI marque error sobre algo que en realidad se guardaría.
 */

export const LARGO_MINIMO = 8;

/**
 * Contraseñas que un atacante prueba en los primeros intentos. No pretende ser exhaustiva
 * —para eso está el chequeo contra filtraciones— sino cubrir lo que realmente aparece en
 * un sistema recién instalado: los defaults, el teclado y el nombre del producto.
 */
const PROHIBIDAS = new Set([
  "12345678", "123456789", "1234567890", "password", "password1", "passw0rd",
  "qwertyui", "qwerty123", "11111111", "00000000", "abcd1234", "abc12345",
  "contrasena", "contraseña", "administrador", "admin1234", "adminadmin",
  "creditflow", "creditzero", "argentina", "iloveyou", "princess", "sunshine",
  "12341234", "asdasdasd", "asdf1234", "1q2w3e4r", "zaq12wsx", "letmein1",
]);

/** Secuencias que, encontradas dentro de la clave, la vuelven trivial de adivinar. */
const SECUENCIAS = ["12345", "abcde", "qwerty", "asdfg", "98765"];

export interface ProblemaPassword {
  /** Mensaje en las palabras del usuario: qué pasa y qué hacer. */
  mensaje: string;
}

export interface ContextoPassword {
  /** Email de la cuenta: la clave no puede ser (o contener) su parte local. */
  email?: string | null;
  /** Nombre de usuario. */
  username?: string | null;
  /** Nombre y/o apellido de la persona. */
  nombre?: string | null;
}

const normalizar = (v: string) =>
  v.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

/** Trozos de identidad que no pueden aparecer dentro de la contraseña. */
function trozosDeIdentidad(ctx: ContextoPassword): string[] {
  const crudos = [
    ctx.email?.split("@")[0] ?? "",
    ctx.username ?? "",
    ...(ctx.nombre ?? "").split(/\s+/),
  ];
  return crudos
    .map(normalizar)
    .map((t) => t.replace(/[^a-z0-9]/g, ""))
    // Menos de 4 caracteres da falsos positivos absurdos (un apellido "Paz" prohibiría
    // cualquier clave que contenga "paz").
    .filter((t) => t.length >= 4);
}

/**
 * Revisa una contraseña y devuelve TODOS sus problemas.
 *
 * Se devuelven todos y no el primero: si se informara de a uno, la persona corregiría el
 * largo, reintentaría, y recién ahí se enteraría de que además contiene su nombre.
 */
export function revisarPassword(password: string, ctx: ContextoPassword = {}): ProblemaPassword[] {
  const problemas: ProblemaPassword[] = [];
  const p = password ?? "";

  if (p.length < LARGO_MINIMO) {
    problemas.push({ mensaje: `Tiene que tener al menos ${LARGO_MINIMO} caracteres (llevás ${p.length}).` });
    // Sin largo mínimo el resto de los avisos sobra: primero que llegue a 8.
    return problemas;
  }

  const n = normalizar(p);

  // Se compara también sin los dígitos del final: "password1", "creditzero2026" y demás son
  // el patrón más común —tomar una palabra débil y pegarle un número— y siguen siendo la
  // misma contraseña débil. El recorte solo cuenta si queda una palabra de verdad.
  const sinSufijo = n.replace(/\d+$/, "");
  if (PROHIBIDAS.has(n) || (sinSufijo.length >= 4 && PROHIBIDAS.has(sinSufijo))) {
    problemas.push({ mensaje: "Es una de las contraseñas más usadas del mundo: se prueba en los primeros intentos." });
  }

  // Un solo carácter repetido ("aaaaaaaa") o dos alternados ("ababab").
  if (/^(.)\1+$/.test(p)) {
    problemas.push({ mensaje: "Es un mismo carácter repetido. Usá algo menos previsible." });
  } else if (new Set(p).size <= 2) {
    problemas.push({ mensaje: "Usa solo dos caracteres distintos. Agregá variedad." });
  }

  for (const s of SECUENCIAS) {
    if (n.includes(s)) {
      problemas.push({ mensaje: `Contiene la secuencia "${s}", de las primeras que se prueban.` });
      break;
    }
  }

  for (const trozo of trozosDeIdentidad(ctx)) {
    if (n.includes(trozo)) {
      problemas.push({
        mensaje: "No puede contener tu nombre, tu usuario ni tu email: es lo primero que prueba quien te conoce.",
      });
      break;
    }
  }

  return problemas;
}

/** ¿Se puede usar? */
export function passwordValida(password: string, ctx: ContextoPassword = {}): boolean {
  return revisarPassword(password, ctx).length === 0;
}

/**
 * Un solo mensaje para las respuestas de la API, que no tienen dónde mostrar una lista.
 * Devuelve null si la contraseña es válida.
 */
export function errorDePassword(password: string, ctx: ContextoPassword = {}): string | null {
  const problemas = revisarPassword(password, ctx);
  if (problemas.length === 0) return null;
  return problemas.map((x) => x.mensaje).join(" ");
}
