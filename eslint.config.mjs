import reactHooks from "eslint-plugin-react-hooks";
import tsParser from "@typescript-eslint/parser";

/**
 * Lint MÍNIMO a propósito: una sola regla, `react-hooks/rules-of-hooks`.
 *
 * 🔴 POR QUÉ EXISTE ESTE ARCHIVO. La ficha del cliente se rompió entera (React #310, pantalla
 * "Algo salió mal") porque un hook quedó DEBAJO del `return` de carga: mientras la ficha
 * carga, el componente sale antes y ejecuta un hook menos que en el render siguiente. Es la
 * SEGUNDA vez que pasa en este archivo — la primera dejó un comentario de advertencia tres
 * renglones más arriba del lugar donde volví a hacerlo. Un comentario no frena nada; esta
 * regla sí, y es exactamente para lo que existe.
 *
 * No se suma un preset entero (`next/core-web-vitals` y demás) a propósito: traería cientos
 * de avisos de estilo sobre código ya escrito y probado, y el ruido haría que nadie lea la
 * salida. Una regla que siempre sale en cero es una regla que sirve: el día que diga algo,
 * hay un bug.
 *
 * Se corre con `npm run lint`. `exhaustive-deps` queda como AVISO, no error: es útil pero
 * tiene falsos positivos y no rompe la pantalla, a diferencia del orden de los hooks.
 */
/**
 * Hay `// eslint-disable-next-line @next/next/no-img-element` repartidos por el código (el
 * proyecto usa `<img>` planos a propósito, no `next/image`). ESLint 9 marca como ERROR un
 * disable que apunta a una regla que no existe, así que sin esto salían 11 errores que no son
 * errores. Se declara la regla como no-op en vez de instalar el plugin entero de Next: acá no
 * queremos sus cientos de avisos de estilo, solo que esos comentarios resuelvan.
 */
const nextNoop = { rules: { "no-img-element": { create: () => ({}) } } };

export default [
  {
    files: ["app/**/*.{ts,tsx}", "components/**/*.{ts,tsx}", "lib/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks, "@next/next": nextNoop },
    languageOptions: {
      // Sin esto ESLint usa su parser de JS y se cae en el primer tipo que encuentra
      // ("Parsing error: Unexpected token") — 308 errores que no son errores.
      parser: tsParser,
      parserOptions: { ecmaFeatures: { jsx: true }, sourceType: "module" },
    },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  },
];
