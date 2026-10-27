// SteriCare's letterhead at the top of every page of the report, as the
// pre-shipment design prints it (Kenneth, 27 October 2026): the app
// owner's own company details, never a client's.
export const STERICARE_LETTERHEAD = {
  company: "SteriCare Sdn. Bhd.",
  registration: "719431-T",
  address: "45A, Jalan Puteri 5/10, Bandar Puteri, 47100 Puchong, Selangor, Malaysia",
  phone: "+60-3-8061 7213",
  email: "enquiry@stericare.com.my",
  website: "www.stericare.com.my",
  /** The website's horizontal logo (public/brand), at its own size. */
  logo: { src: "/brand/stericare-horizontal.png", width: 1331, height: 235 },
} as const;

export type Letterhead = typeof STERICARE_LETTERHEAD;
