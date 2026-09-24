"use client";

import { useEffect, useRef, useState } from "react";
import { BurbujaTooltip, ubicarTooltip, DEMORA_TOOLTIP } from "./Tooltip";

/**
 * TODOS LOS `title=` DEL SAAS, DIBUJADOS CON EL ESTILO DEL SISTEMA.
 *
 * Fernando (21/09/2026): «hagámoslo ahora, el sistema ya está listo para trabajar; de acá en
 * más solo detalles de frontend y UX». Había ~140 `title` nativos repartidos en 66 archivos
 * —112 de ellos en botones de acción—, y migrarlos a mano era tocar medio front una semana
 * antes de entregar, con el riesgo que eso trae y ninguna ganancia extra.
 *
 * 🔴 CÓMO FUNCIONA, PORQUE NO ES OBVIO AL LEER UNA PANTALLA.
 *
 * Un solo escucha delegado en el documento. Al pasar por encima de algo con `title`:
 *
 *   1. se guarda el texto en `data-tip` y se BORRA el `title` — es la única forma de callar
 *      el globo del navegador, que no se puede desactivar por CSS;
 *   2. se dibuja el globo del sistema en su lugar;
 *   3. al salir, el `title` VUELVE al elemento.
 *
 * El paso 3 no es cosmético: el atributo tiene que estar ahí en reposo para los lectores de
 * pantalla y para cualquier herramienta que lea el DOM. Mientras el globo está abierto, el
 * elemento queda descrito por `aria-describedby`, así que el aviso nunca deja de existir para
 * quien no ve la pantalla.
 *
 * También responde al TECLADO (`focusin`), que es lo que el nativo nunca hizo: un aviso que
 * explica por qué un botón está apagado no puede ser solo para quien usa mouse.
 *
 * Para contenido que no sea texto plano —importes con formato, varias líneas— está el
 * componente `<Tooltip texto={…}>`, que pinta exactamente el mismo globo.
 */
const ID_GLOBO = "tooltip-nativo";

export function TooltipsNativos() {
  const [tip, setTip] = useState<{ texto: string; x: number; y: number; abajo: boolean } | null>(null);
  const actual = useRef<HTMLElement | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    /** Devuelve el `title` al elemento y limpia lo que se le agregó. */
    const restaurar = () => {
      const el = actual.current;
      if (el) {
        const guardado = el.getAttribute("data-tip");
        if (guardado != null) {
          el.setAttribute("title", guardado);
          el.removeAttribute("data-tip");
        }
        if (el.getAttribute("aria-describedby") === ID_GLOBO) el.removeAttribute("aria-describedby");
      }
      actual.current = null;
    };

    const ocultar = () => {
      if (timer.current) clearTimeout(timer.current);
      restaurar();
      setTip(null);
    };

    const preparar = (el: HTMLElement) => {
      const texto = (el.getAttribute("title") ?? "").trim();
      if (!texto) return;
      // El `title` se va mientras dura el hover: es lo único que calla al nativo.
      el.setAttribute("data-tip", texto);
      el.removeAttribute("title");
      el.setAttribute("aria-describedby", ID_GLOBO);
      actual.current = el;
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        if (actual.current !== el || !el.isConnected) return;
        setTip({ texto, ...ubicarTooltip(el) });
      }, DEMORA_TOOLTIP);
    };

    const entrar = (e: Event) => {
      const destino = e.target;
      if (!(destino instanceof Element)) return;
      const el = destino.closest<HTMLElement>("[title]");
      if (!el) return;
      /*
        Un re-render de React puede devolverle el `title` al elemento que ya está bajo el
        mouse. Sin este corte, el globo se reabriría solo cada vez que la pantalla refresca.
      */
      if (el === actual.current) { el.setAttribute("data-tip", el.getAttribute("title") ?? ""); el.removeAttribute("title"); return; }
      restaurar();
      preparar(el);
    };

    const salir = (e: Event) => {
      const el = actual.current;
      if (!el) return;
      const hacia = (e as MouseEvent | FocusEvent).relatedTarget;
      // Moverse DENTRO del mismo botón (al ícono, al texto) no es salir.
      if (hacia instanceof Node && el.contains(hacia)) return;
      ocultar();
    };

    const alTeclear = (e: KeyboardEvent) => { if (e.key === "Escape") ocultar(); };

    /**
     * 🔴 RED DE SEGURIDAD: `mouseout` NO SIEMPRE LLEGA, Y SIN ÉL EL GLOBO SE QUEDA PEGADO.
     *
     * Fernando (24/09/2026): «al pasar el mouse aparece la ayuda pero no se va y me tapa los
     * botones; ese comportamiento lo noté en todo el SaaS».
     *
     * El motivo: ocultar dependía de que el navegador avisara la salida del elemento. Si ese
     * elemento deja de existir mientras el mouse está encima —React redibuja la fila porque
     * los datos se refrescaron, la lista se filtra, el crédito cambia de página—, el nodo se
     * desconecta del documento y el `mouseout` no ocurre nunca. El globo queda anclado a algo
     * que ya no está, y encima suele quedar justo arriba de la acción que se iba a apretar.
     *
     * Las dos salidas no dependen del evento que falla:
     *  · cualquier movimiento del mouse fuera del ancla lo cierra —y de paso detecta el ancla
     *    desconectada, que es el caso que lo dejaba pegado—;
     *  · un ronda periódica, para cuando el nodo se va y el mouse se queda quieto (ahí no hay
     *    ningún evento del que colgarse).
     *
     * El globo tiene `pointer-events-none`, así que cuando tapa al propio disparador el
     * movimiento sigue llegando al elemento de abajo y no se cierra solo: se cierra recién al
     * salir de verdad, que es lo que corresponde.
     */
    const vigilar = (e: MouseEvent) => {
      const el = actual.current;
      if (!el) return;
      if (!el.isConnected) { ocultar(); return; }
      const destino = e.target;
      if (destino instanceof Node && el.contains(destino)) return;
      ocultar();
    };

    /** El ancla se fue del documento y el mouse no se movió: no hay evento que lo cuente. */
    const ronda = setInterval(() => {
      const el = actual.current;
      if (el && !el.isConnected) ocultar();
    }, 400);

    /* Al apretar cualquier cosa, el globo sobra: o se abre un diálogo, o se navega, o se
       ejecuta la acción que el globo estaba explicando. */
    const alApretar = () => ocultar();

    document.addEventListener("mousemove", vigilar, true);
    document.addEventListener("pointerdown", alApretar, true);
    document.addEventListener("mouseover", entrar, true);
    document.addEventListener("mouseout", salir, true);
    document.addEventListener("focusin", entrar, true);
    document.addEventListener("focusout", salir, true);
    document.addEventListener("keydown", alTeclear, true);
    // Al scrollear o cambiar de tamaño, el globo quedaría flotando lejos del botón.
    window.addEventListener("scroll", ocultar, true);
    window.addEventListener("resize", ocultar);
    return () => {
      clearInterval(ronda);
      document.removeEventListener("mousemove", vigilar, true);
      document.removeEventListener("pointerdown", alApretar, true);
      document.removeEventListener("mouseover", entrar, true);
      document.removeEventListener("mouseout", salir, true);
      document.removeEventListener("focusin", entrar, true);
      document.removeEventListener("focusout", salir, true);
      document.removeEventListener("keydown", alTeclear, true);
      window.removeEventListener("scroll", ocultar, true);
      window.removeEventListener("resize", ocultar);
      // Si la app se desmonta con un globo abierto, el `title` tiene que volver igual.
      restaurar();
    };
  }, []);

  if (!tip) return null;
  return <BurbujaTooltip id={ID_GLOBO} x={tip.x} y={tip.y} abajo={tip.abajo}>{tip.texto}</BurbujaTooltip>;
}
