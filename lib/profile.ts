/** Shaped like Unipile's `GET /users/{id}` response, so phase 3 swaps the source without touching the prompt. */
export type Profile = {
  name: string
  headline: string
  location: string
  work_experience: { position: string; company: string; duration: string; description?: string }[]
  education: { school: string; degree: string }[]
  skills: string[]
}

// ponytail: fixture until Unipile lands (phase 3). Kept realistic so prompt tuning transfers.
export const FIXTURE: Profile = {
  name: "Marta Oyelaran",
  headline: "Analog & Mixed-Signal IC Design Engineer at Intel",
  location: "Munich, Bavaria, Germany",
  work_experience: [
    {
      position: "Senior Analog Design Engineer",
      company: "Intel Corporation",
      duration: "2019 — Present",
      description:
        "Design of high-speed SerDes front-ends in 7nm and 5nm FinFET. Owned the CTLE and VGA blocks for a 112G PAM4 receiver. Silicon bring-up and correlation across three tape-outs.",
    },
    {
      position: "Analog Design Engineer",
      company: "Infineon Technologies",
      duration: "2015 — 2019",
      description:
        "Bandgap references, LDOs and ADC drivers for automotive sensor interfaces in 130nm BCD.",
    },
  ],
  education: [
    { school: "TU München", degree: "MSc Electrical Engineering, Microelectronics" },
  ],
  skills: ["Cadence Virtuoso", "SerDes", "PLL design", "Spectre", "FinFET", "Layout supervision"],
}
