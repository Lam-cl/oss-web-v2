import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "SIM Replacement Terms & Conditions",
};

const sections = [
  {
    title: "1. Eligibility",
    items: [
      "SIM Replacement is available to existing tone wow members whose SIM cards are lost, stolen, damaged or defective.",
      "The SIM Replacement request must be submitted by the registered SIM card owner.",
      "tone wow reserves the right to verify the customer’s identity and account ownership before processing any SIM Replacement request.",
    ],
  },
  {
    title: "2. SIM Replacement Request",
    items: [
      "Customers may submit a SIM Replacement request through the designated tone wow Customer Support channels or other channels made available by tone wow.",
      "Customers are required to provide the necessary information and supporting documents for verification purposes.",
      "Please ensure your account status is Active before submit the SIM replacement request.",
      "tone wow reserves the right to reject any request if the information or documents provided are incomplete, inaccurate or cannot be verified.",
      "Any SIM Replacement request initiated through the tone wow App requires the customer to click on “Activate Replacement” upon receiving the replacement SIM card to complete the activation process.",
    ],
  },
  {
    title: "3. SIM Replacement Fee",
    items: [
      "SIM Replacement is free of charge for the first two (2) replacement requests. A fee of RM10 will be charged for each subsequent replacement request, applicable to both physical SIM and eSIM replacements.",
      "Any applicable fee must be paid before the SIM Replacement request can be processed.",
      "The SIM Replacement fee is non-refundable once the replacement process has been initiated.",
    ],
  },
  {
    title: "4. SIM Replacement Processing",
    items: [
      "The replacement SIM card will be issued upon successful verification and approval of the request.",
      "The physical replacement SIM card will be delivered within 1–3 working days.",
      "The existing mobile number and credit balance will be retained and transferred to the replacement SIM card, subject to successful verification and applicable technical requirements.",
      "The old SIM card will be deactivated once the replacement SIM card has been successfully activated.",
      "Customers are responsible for ensuring that all information provided during the replacement process is accurate and complete.",
    ],
  },
  {
    title: "5. Customer Responsibilities",
    items: [
      "Customers must immediately report any lost or stolen SIM card to tone wow to prevent unauthorized usage.",
      "Customers are responsible for any usage, charges or transactions incurred before the lost or stolen SIM card is reported and suspended, subject to applicable laws and regulations.",
    ],
  },
  {
    title: "6. Limitation of Liability",
    items: [
      "tone wow shall not be held responsible for any loss, damage or unauthorized usage arising from the customer’s failure to report a lost or stolen SIM card promptly.",
      "tone wow shall not be liable for any delay in processing a SIM Replacement request due to incomplete documentation, failed verification, technical issues or circumstances beyond its reasonable control.",
    ],
  },
  {
    title: "7. General Terms",
    items: [
      "tone wow reserves the right to approve or reject any SIM Replacement request based on its verification and security procedures.",
      "tone wow reserves the right to amend these Terms & Conditions from time to time without prior notice, subject to applicable laws and regulations.",
      "All SIM Replacement requests are subject to tone wow’s applicable policies, procedures and prevailing telecommunications regulations.",
    ],
  },
];

export default function SimReplacementTncPage() {
  return (
    <main
      style={{
        maxWidth: 800,
        margin: "0 auto",
        padding: "2rem 1rem",
        lineHeight: 1.6,
      }}
    >
      <h1 style={{ marginBottom: "0.75rem" }}>
        SIM Replacement Terms &amp; Conditions
      </h1>
      <p>
        By submitting a SIM Replacement request, the customer is deemed to have
        read, understood and agreed to the following Terms &amp; Conditions:
      </p>

      {sections.map((section) => (
        <section key={section.title}>
          <h2 style={{ margin: "1.75rem 0 0.5rem", fontSize: "1.25rem" }}>
            {section.title}
          </h2>
          <ul style={{ margin: 0, paddingLeft: "1.25rem" }}>
            {section.items.map((item) => (
              <li key={item} style={{ marginBottom: "0.5rem" }}>
                {item}
              </li>
            ))}
          </ul>
        </section>
      ))}

      <p style={{ marginTop: "2rem" }}>
        By proceeding with the SIM Replacement request, the customer
        acknowledges and agrees to these Terms &amp; Conditions.
      </p>
    </main>
  );
}