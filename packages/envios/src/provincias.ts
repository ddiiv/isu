/* Provincia (como la escribe el cliente) → código de una letra (ISO 3166-2:AR, el que usan los correos). */
const CODIGOS: Record<string, string> = {
  "buenos aires": "B", "provincia de buenos aires": "B", "gba": "B",
  "caba": "C", "capital federal": "C", "ciudad autonoma de buenos aires": "C", "ciudad de buenos aires": "C",
  catamarca: "K", chaco: "H", chubut: "U", cordoba: "X", corrientes: "W", "entre rios": "E", formosa: "P", jujuy: "Y",
  "la pampa": "L", "la rioja": "F", mendoza: "M", misiones: "N", neuquen: "Q", "rio negro": "R", salta: "A",
  "san juan": "J", "san luis": "D", "santa cruz": "Z", "santa fe": "S", "santiago del estero": "G",
  "tierra del fuego": "V", tucuman: "T",
};
export function codigoProvincia(p: string | null | undefined): string {
  const n = (p ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();
  if (/^[a-z]$/.test(n)) return n.toUpperCase();
  return CODIGOS[n] ?? CODIGOS[n.replace(/^provincia de /, "")] ?? "";
}
