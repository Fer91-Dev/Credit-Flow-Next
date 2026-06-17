import { LegalPage } from "@/components/legal/LegalPage";

export default function PrivacidadPage() {
  return (
    <LegalPage
      titulo="Políticas de Privacidad"
      actualizado="2026"
      intro="En CreditFlow protegemos los datos personales de clientes y usuarios conforme a la Ley 25.326 de Protección de Datos Personales y a la normativa de la Agencia de Acceso a la Información Pública (AAIP). Esta política describe qué datos recopilamos, con qué finalidad y cómo se ejercen los derechos sobre ellos."
      secciones={[
        { titulo: "Datos que recopilamos", cuerpo: "Datos identificatorios (nombre, DNI/CUIT), de contacto (teléfono, email, domicilio), laborales e ingresos, y la información crediticia necesaria para evaluar y administrar los créditos." },
        { titulo: "Finalidad del tratamiento", cuerpo: "Evaluación crediticia, otorgamiento y administración de créditos, gestión de cobranzas, cumplimiento de obligaciones legales e impositivas, y comunicaciones operativas con el cliente." },
        { titulo: "Base legal y consentimiento", cuerpo: "El tratamiento se basa en el consentimiento del titular y en el cumplimiento de relaciones contractuales y obligaciones legales aplicables." },
        { titulo: "Conservación y seguridad", cuerpo: "Los datos se conservan durante el tiempo necesario para las finalidades indicadas y según los plazos legales, aplicando medidas técnicas y organizativas de seguridad." },
        { titulo: "Derechos del titular", cuerpo: "El titular puede ejercer los derechos de acceso, rectificación, actualización y supresión de sus datos. La AAIP, órgano de control de la Ley 25.326, tiene la atribución de atender denuncias y reclamos." },
        { titulo: "Contacto", cuerpo: "Para ejercer estos derechos o realizar consultas sobre privacidad, escribinos al canal de contacto indicado en el pie del sitio." },
      ]}
    />
  );
}
