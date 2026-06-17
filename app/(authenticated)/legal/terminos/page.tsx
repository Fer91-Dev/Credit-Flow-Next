import { LegalPage } from "@/components/legal/LegalPage";

export default function TerminosPage() {
  return (
    <LegalPage
      titulo="Términos y Condiciones"
      actualizado="2026"
      intro="Estos Términos y Condiciones regulan el uso de la plataforma CreditFlow y los servicios de gestión de créditos, cobranzas y pagos. Al utilizar el servicio, el usuario acepta las condiciones aquí descriptas."
      secciones={[
        { titulo: "Objeto del servicio", cuerpo: "CreditFlow provee herramientas para la administración de clientes, otorgamiento y seguimiento de créditos, cálculo de cuotas e intereses, y registro de cobranzas y caja." },
        { titulo: "Condiciones de los créditos", cuerpo: "Las tasas, plazos, cargos y el Costo Financiero Total (CFT) aplicables a cada crédito se informan al momento de su otorgamiento, conforme a la normativa vigente." },
        { titulo: "Obligaciones del usuario", cuerpo: "El usuario se compromete a brindar información veraz y a utilizar la plataforma conforme a la ley y a estos términos." },
        { titulo: "Mora e intereses", cuerpo: "El atraso en el pago de las cuotas genera intereses moratorios según las condiciones pactadas y la configuración vigente de la financiera." },
        { titulo: "Limitación de responsabilidad", cuerpo: "El servicio se presta según su estado y disponibilidad. CreditFlow no será responsable por daños indirectos derivados del uso de la plataforma, en la medida permitida por la ley." },
        { titulo: "Ley aplicable y jurisdicción", cuerpo: "Estos términos se rigen por las leyes de la República Argentina. Ante cualquier conflicto, será competente la jurisdicción que corresponda según la normativa de defensa del consumidor." },
      ]}
    />
  );
}
