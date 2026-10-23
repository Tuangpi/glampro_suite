import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router";
import api, { getErrorMessage } from "@/lib/api";

interface PublicService {
  id: string;
  name: string;
  durationMinutes: number | null;
  price: number | null;
}
interface PublicConfig {
  tenant: { name: string; slug: string; timeZone: string; locale: string };
  depositAmount: number;
  noShowFee: number;
  services: PublicService[];
  hours: Record<string, string | null> | null;
  privacyNotice: { id: string; version: string; dataConsentText: string } | null;
}

export default function PublicBooking() {
  const { slug } = useParams();
  return <Booking key={slug} slug={slug} />;
}

function Booking({ slug }: { slug: string | undefined }) {
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [serviceId, setServiceId] = useState("");
  const [date, setDate] = useState("");
  const [selectedSlot, setSelectedSlot] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [consent, setConsent] = useState(false);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [availability, setAvailability] = useState<{
    key: string;
    slots: string[];
    loading: boolean;
    error: string;
  }>({ key: "", slots: [], loading: false, error: "" });
  const [booked, setBooked] = useState(false);
  const submitting = useRef(false);
  const slotKey = `${serviceId}:${date}`;
  const currentSlots = availability.key === slotKey ? availability.slots : [];

  useEffect(() => {
    if (!slug) return;
    let active = true;
    api
      .get(`/public/booking/${slug}`)
      .then((r) => {
        if (active) setConfig((r.data?.data ?? r.data) as PublicConfig);
      })
      .catch(() => {
        if (active) setMessage("Online booking not available.");
      });
    return () => {
      active = false;
    };
  }, [slug]);

  useEffect(() => {
    if (!slug || !serviceId || !date) return;
    let active = true;
    api
      .get(`/public/booking/${slug}/availability`, { params: { serviceId, date } })
      .then((r) => {
        if (active)
          setAvailability({
            key: `${serviceId}:${date}`,
            slots: ((r.data?.data ?? r.data) as { slots?: string[] }).slots ?? [],
            loading: false,
            error: "",
          });
      })
      .catch(() => {
        if (active)
          setAvailability({
            key: `${serviceId}:${date}`,
            slots: [],
            loading: false,
            error: "Available times could not be loaded. Change the date to try again.",
          });
      });
    return () => {
      active = false;
    };
  }, [slug, serviceId, date]);

  const book = async () => {
    if (
      submitting.current ||
      booked ||
      !config?.privacyNotice ||
      !consent ||
      !name.trim() ||
      (!phone.trim() && !email.trim()) ||
      !currentSlots.includes(selectedSlot)
    )
      return;
    submitting.current = true;
    setLoading(true);
    setMessage("");
    try {
      const res = await api.post(`/public/booking/${slug}`, {
        serviceId,
        startsAt: selectedSlot,
        customerName: name,
        customerPhone: phone || null,
        customerEmail: email || null,
        consentGiven: consent,
        noticeId: config.privacyNotice.id,
      });
      const data = (res.data?.data ?? res.data) as { message?: string };
      setMessage(data?.message ?? "Booked.");
      setBooked(true);
    } catch (e: unknown) {
      setMessage(getErrorMessage(e));
      setSelectedSlot("");
      setAvailability({
        key: slotKey,
        slots: [],
        loading: false,
        error: "Please select another date to reload available times.",
      });
    } finally {
      setLoading(false);
      submitting.current = false;
    }
  };

  if (!config) return <div className="p-6">{message || "Loading..."}</div>;
  const money = (cents: number) =>
    new Intl.NumberFormat(config.tenant.locale, {
      style: "currency",
      currency: "SGD",
      currencyDisplay: "code",
    }).format(cents / 100);
  const changeSelection = (service: string, day: string) => {
    setServiceId(service);
    setDate(day);
    setSelectedSlot("");
    setAvailability({
      key: `${service}:${day}`,
      slots: [],
      loading: Boolean(service && day),
      error: "",
    });
  };

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-4">
      <h1 className="text-2xl font-bold">{config.tenant.name} — Book online</h1>
      <p>All appointment times are shown in {config.tenant.timeZone}.</p>
      {config.depositAmount > 0 && (
        <p>
          Deposit required: {money(config.depositAmount)}. Contact the salon to arrange payment.
        </p>
      )}
      {config.noShowFee > 0 && (
        <p>No-show fee policy: {money(config.noShowFee)}. Contact the salon for the terms.</p>
      )}
      <p>No payment is collected or automatically charged on this page.</p>

      <div>
        <label htmlFor="booking-service">Service</label>
        <select
          id="booking-service"
          disabled={loading || booked}
          value={serviceId}
          onChange={(e) => changeSelection(e.target.value, date)}
          className="border p-2 w-full"
        >
          <option value="">Select service</option>
          {config.services.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} ({s.durationMinutes ?? 60} min)
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="booking-date">Date</label>
        <input
          id="booking-date"
          disabled={loading || booked}
          type="date"
          value={date}
          onChange={(e) => changeSelection(serviceId, e.target.value)}
          className="border p-2 w-full"
        />
      </div>

      <div>
        <label htmlFor="booking-slot">Time slot</label>
        <select
          id="booking-slot"
          disabled={loading || booked || availability.loading}
          value={selectedSlot}
          onChange={(e) => setSelectedSlot(e.target.value)}
          className="border p-2 w-full"
        >
          <option value="">Select slot</option>
          {currentSlots.map((s) => (
            <option key={s} value={s}>
              {new Intl.DateTimeFormat(config.tenant.locale, {
                timeZone: config.tenant.timeZone,
                dateStyle: "medium",
                timeStyle: "short",
              }).format(new Date(s))}
            </option>
          ))}
        </select>
        {availability.loading && <p role="status">Loading available times…</p>}
        {availability.error && <p role="alert">{availability.error}</p>}
        {serviceId &&
          date &&
          availability.key === slotKey &&
          !availability.loading &&
          !availability.error &&
          currentSlots.length === 0 && <p>No available times on this date.</p>}
      </div>

      <div>
        <label htmlFor="booking-name">Name</label>
        <input
          id="booking-name"
          disabled={loading || booked}
          maxLength={200}
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="border p-2 w-full"
        />
      </div>
      <div>
        <label htmlFor="booking-phone">Phone</label>
        <input
          id="booking-phone"
          disabled={loading || booked}
          type="tel"
          maxLength={50}
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          className="border p-2 w-full"
        />
      </div>
      <div>
        <label htmlFor="booking-email">Email</label>
        <input
          id="booking-email"
          disabled={loading || booked}
          type="email"
          maxLength={254}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="border p-2 w-full"
        />
      </div>

      <p>Provide a phone number or email so the salon can contact you.</p>
      {config.privacyNotice ? (
        <section aria-label="Privacy notice">
          <h2>Privacy notice — {config.privacyNotice.version}</h2>
          <p className="whitespace-pre-wrap">{config.privacyNotice.dataConsentText}</p>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              disabled={loading || booked}
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
            />
            I consent to this privacy notice for my booking. This does not opt me in to marketing.
          </label>
        </section>
      ) : (
        <p role="alert">
          Online booking requires a published privacy notice. Please contact the salon.
        </p>
      )}

      <button
        onClick={book}
        disabled={
          loading ||
          booked ||
          availability.loading ||
          !config.privacyNotice ||
          !consent ||
          !name.trim() ||
          (!phone.trim() && !email.trim()) ||
          !currentSlots.includes(selectedSlot)
        }
        className="bg-blue-600 text-white px-4 py-2 rounded"
      >
        {loading ? "Booking..." : "Book"}
      </button>

      {message && (
        <p role="status" className="mt-2">
          {message}
        </p>
      )}
    </div>
  );
}
