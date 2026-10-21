import { useEffect, useState } from "react";
import { useParams } from "react-router";
import api from "@/lib/api";

interface PublicService { id: string; name: string; durationMinutes: number | null; price: number | null; }
interface PublicConfig {
  tenant: { name: string; slug: string; timeZone: string; locale: string };
  depositAmount: number;
  noShowFee: number;
  services: PublicService[];
  hours: Record<string, string | null> | null;

}

export default function PublicBooking() {
  const { slug } = useParams();
  const [config, setConfig] = useState<PublicConfig | null>(null);
  const [serviceId, setServiceId] = useState("");
  const [date, setDate] = useState("");
  const [slots, setSlots] = useState<string[]>([]);
  const [selectedSlot, setSelectedSlot] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [consent, setConsent] = useState(false);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!slug) return;
    api.get(`/public/booking/${slug}`).then((r) => {
      setConfig((r.data?.data ?? r.data) as PublicConfig);
    }).catch(() => setMessage("Online booking not available."));
  }, [slug]);

  useEffect(() => {
    if (!slug || !serviceId || !date) return;
    api.get(`/public/booking/${slug}/availability`, { params: { serviceId, date } })
      .then((r) => setSlots(((r.data?.data ?? r.data) as { slots?: string[] }).slots ?? []))
      .catch(() => setSlots([]));
  }, [slug, serviceId, date]);

  const book = async () => {
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
      });
      const data = (res.data?.data ?? res.data) as { message?: string };
      setMessage(data?.message ?? "Booked.");
    } catch (e: unknown) {
      const err = e as { response?: { data?: { message?: string } } };
      setMessage(err?.response?.data?.message ?? "Booking failed.");
    } finally {
      setLoading(false);
    }
  };


  if (!config) return <div className="p-6">{message || "Loading..."}</div>;

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-4">
      <h1 className="text-2xl font-bold">{config.tenant.name} — Book online</h1>
      {config.depositAmount > 0 && <p>Deposit required: {config.depositAmount} cents</p>}
      {config.noShowFee > 0 && <p>No-show fee: {config.noShowFee} cents</p>}

      <div>
        <label>Service</label>
        <select value={serviceId} onChange={(e) => setServiceId(e.target.value)} className="border p-2 w-full">
          <option value="">Select service</option>
          {config.services.map((s) => (
            <option key={s.id} value={s.id}>{s.name} ({s.durationMinutes ?? 30} min)</option>
          ))}
        </select>
      </div>

      <div>
        <label>Date</label>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="border p-2 w-full" />
      </div>

      <div>
        <label>Time slot</label>
        <select value={selectedSlot} onChange={(e) => setSelectedSlot(e.target.value)} className="border p-2 w-full">
          <option value="">Select slot</option>
          {slots.map((s) => <option key={s} value={s}>{new Date(s).toLocaleString()}</option>)}
        </select>
      </div>

      <div>
        <label>Name</label>
        <input value={name} onChange={(e) => setName(e.target.value)} className="border p-2 w-full" />
      </div>
      <div>
        <label>Phone</label>
        <input value={phone} onChange={(e) => setPhone(e.target.value)} className="border p-2 w-full" />
      </div>
      <div>
        <label>Email</label>
        <input value={email} onChange={(e) => setEmail(e.target.value)} className="border p-2 w-full" />
      </div>

      <label className="flex items-center gap-2">
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
        I consent to the privacy notice (PDPA).
      </label>

      <button onClick={book} disabled={loading} className="bg-blue-600 text-white px-4 py-2 rounded">
        {loading ? "Booking..." : "Book"}
      </button>

      {message && <p className="mt-2">{message}</p>}
    </div>
  );
}
