import { LegalPage } from "@/components/legal/LegalPage";

export default function ArrepentimientoPage() {
  return (
    <LegalPage
      titulo="Botón de arrepentimiento"
      actualizado="2026"
      intro="Conforme a la Resolución 424/2020 de la Secretaría de Comercio Interior y a la Ley 24.240 de Defensa del Consumidor, tenés derecho a arrepentirte y revocar la contratación dentro de los 10 (diez) días corridos de celebrada, sin necesidad de expresar la causa y sin costo alguno."
      secciones={[
        { titulo: "¿Quién puede solicitarlo?", cuerpo: "El consumidor que haya contratado un servicio o crédito a distancia (web, teléfono u otros medios electrónicos) y se encuentre dentro del plazo legal de 10 días corridos." },
        { titulo: "¿Cómo solicitarlo?", cuerpo: "Comunicate por el canal de contacto indicado en el pie del sitio (email o teléfono) informando tu nombre, DNI y la operación que querés revocar. La solicitud será procesada sin cargo." },
        { titulo: "Efectos del arrepentimiento", cuerpo: "Una vez recibida la solicitud en término, se dejará sin efecto la contratación y se restituirán los importes que correspondan, conforme a la normativa vigente." },
      ]}
    />
  );
}
