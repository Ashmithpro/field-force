import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { DatasetKey } from './types'
import { readPreference, savePreference } from './storage'
import { datasets } from './data/datasets'
import englishLocale from './locales/en.json'

export const languages = [
  { code: 'en', name: 'English' },
  { code: 'es', name: 'Español' },
  { code: 'fr', name: 'Français' },
  { code: 'de', name: 'Deutsch' },
  { code: 'pt', name: 'Português' },
  { code: 'zh', name: '中文' },
  { code: 'ja', name: '日本語' },
  { code: 'ko', name: '한국어' },
  { code: 'hi', name: 'हिन्दी' },
  { code: 'ar', name: 'العربية' },
  { code: 'it', name: 'Italiano' },
  { code: 'ru', name: 'Русский' },
  { code: 'id', name: 'Bahasa Indonesia' },
  { code: 'nl', name: 'Nederlands' },
  { code: 'tr', name: 'Türkçe' },
  { code: 'bn', name: 'বাংলা' },
  { code: 'ur', name: 'اردو' },
  { code: 'sw', name: 'Kiswahili' },
  { code: 'pl', name: 'Polski' },
  { code: 'uk', name: 'Українська' },
  { code: 'vi', name: 'Tiếng Việt' },
  { code: 'th', name: 'ไทย' },
  { code: 'fil', name: 'Filipino' },
  { code: 'fa', name: 'فارسی' },
  { code: 'el', name: 'Ελληνικά' },
  { code: 'he', name: 'עברית' },
  { code: 'sv', name: 'Svenska' },
  { code: 'ta', name: 'தமிழ்' },
  { code: 'te', name: 'తెలుగు' },
  { code: 'ms', name: 'Bahasa Melayu' },
] as const

export type Language = typeof languages[number]['code']
type Pattern = { source: string; target: string }
type LocaleBundle = { messages: Record<string, string>; content: Record<string, string>; patterns: Pattern[] }
type MessageKey = Exclude<keyof typeof englishLocale.messages, 'datasetNames'>
type LocaleLoader = () => Promise<LocaleBundle>

const localeLoaders: Partial<Record<Language, LocaleLoader>> = {
  es: () => import('./locales/es.json').then((module) => module.default),
  fr: () => import('./locales/fr.json').then((module) => module.default),
  de: () => import('./locales/de.json').then((module) => module.default),
  pt: () => import('./locales/pt.json').then((module) => module.default),
  zh: () => import('./locales/zh.json').then((module) => module.default),
  ja: () => import('./locales/ja.json').then((module) => module.default),
  ko: () => import('./locales/ko.json').then((module) => module.default),
  hi: () => import('./locales/hi.json').then((module) => module.default),
  ar: () => import('./locales/ar.json').then((module) => module.default),
  it: () => import('./locales/it.json').then((module) => module.default),
  ru: () => import('./locales/ru.json').then((module) => module.default),
  id: () => import('./locales/id.json').then((module) => module.default),
  nl: () => import('./locales/nl.json').then((module) => module.default),
  tr: () => import('./locales/tr.json').then((module) => module.default),
  bn: () => import('./locales/bn.json').then((module) => module.default),
  ur: () => import('./locales/ur.json').then((module) => module.default),
  sw: () => import('./locales/sw.json').then((module) => module.default),
  pl: () => import('./locales/pl.json').then((module) => module.default),
  uk: () => import('./locales/uk.json').then((module) => module.default),
  vi: () => import('./locales/vi.json').then((module) => module.default),
  th: () => import('./locales/th.json').then((module) => module.default),
  fil: () => import('./locales/fil.json').then((module) => module.default),
  fa: () => import('./locales/fa.json').then((module) => module.default),
  el: () => import('./locales/el.json').then((module) => module.default),
  he: () => import('./locales/he.json').then((module) => module.default),
  sv: () => import('./locales/sv.json').then((module) => module.default),
  ta: () => import('./locales/ta.json').then((module) => module.default),
  te: () => import('./locales/te.json').then((module) => module.default),
  ms: () => import('./locales/ms.json').then((module) => module.default),
}

const rtlLanguages = new Set<Language>(['ar', 'fa', 'he', 'ur'])
const localeTags: Record<Language, string> = {
  en: 'en', es: 'es', fr: 'fr', de: 'de', pt: 'pt-BR', zh: 'zh-CN', ja: 'ja', ko: 'ko',
  hi: 'hi', ar: 'ar', it: 'it', ru: 'ru', id: 'id', nl: 'nl', tr: 'tr', bn: 'bn', ur: 'ur',
  sw: 'sw', pl: 'pl', uk: 'uk', vi: 'vi', th: 'th', fil: 'fil-PH', fa: 'fa', el: 'el', he: 'he',
  sv: 'sv', ta: 'ta', te: 'te', ms: 'ms',
}
const featureMessageTranslations: Partial<Record<Language, Partial<Record<string, string>>>> = {
  es: { myLocation: 'Mi ubicación', locating: 'Buscando tu ubicación…' },
  fr: { myLocation: 'Ma position', locating: 'Recherche de votre position…' },
  de: { myLocation: 'Mein Standort', locating: 'Standort wird ermittelt…' },
  pt: { myLocation: 'Minha localização', locating: 'Localizando…' },
  zh: { myLocation: '我的位置', locating: '正在查找位置…' },
  ja: { myLocation: '現在地', locating: '位置を確認中…' },
  ko: { myLocation: '내 위치', locating: '위치 찾는 중…' },
  hi: { myLocation: 'मेरा स्थान', locating: 'आपका स्थान खोज रहे हैं…' },
  ar: { myLocation: 'موقعي', locating: 'جارٍ تحديد موقعك…' },
  it: { myLocation: 'La mia posizione', locating: 'Ricerca della posizione…' },
  ru: { myLocation: 'Моё местоположение', locating: 'Определяем местоположение…' },
  id: { myLocation: 'Lokasi saya', locating: 'Mencari lokasi…' },
  nl: { myLocation: 'Mijn locatie', locating: 'Locatie zoeken…' },
  tr: { myLocation: 'Konumum', locating: 'Konumunuz bulunuyor…' },
  bn: { myLocation: 'আমার অবস্থান', locating: 'আপনার অবস্থান খোঁজা হচ্ছে…' },
  ur: { myLocation: 'میرا مقام', locating: 'آپ کا مقام تلاش کیا جا رہا ہے…' },
  sw: { myLocation: 'Mahali nilipo', locating: 'Inatafuta mahali ulipo…' },
  pl: { myLocation: 'Moja lokalizacja', locating: 'Ustalanie lokalizacji…' },
  uk: { myLocation: 'Моє місце', locating: 'Визначаємо ваше місце…' },
  vi: { myLocation: 'Vị trí của tôi', locating: 'Đang tìm vị trí…' },
  th: { myLocation: 'ตำแหน่งของฉัน', locating: 'กำลังค้นหาตำแหน่ง…' },
  fil: { myLocation: 'Lokasyon ko', locating: 'Hinahanap ang lokasyon…' },
  fa: { myLocation: 'موقعیت من', locating: 'در حال یافتن موقعیت…' },
  el: { myLocation: 'Η τοποθεσία μου', locating: 'Εντοπισμός τοποθεσίας…' },
  he: { myLocation: 'המיקום שלי', locating: 'מאתרים את המיקום…' },
  sv: { myLocation: 'Min plats', locating: 'Hämtar din plats…' },
  ta: { myLocation: 'என் இருப்பிடம்', locating: 'இருப்பிடம் தேடப்படுகிறது…' },
  te: { myLocation: 'నా స్థానం', locating: 'మీ స్థానాన్ని వెతుకుతోంది…' },
  ms: { myLocation: 'Lokasi saya', locating: 'Sedang mencari lokasi…' },
}
const locationMessageTranslations: Partial<Record<Language, Partial<Record<MessageKey, string>>>> = {
  es: { locationFound: 'Ubicación fijada. Las coordenadas exactas no se incluyen en los enlaces.', locationUnsupported: 'Ubicación no disponible aquí. Elige una ciudad o marca el mapa.', locationDenied: 'Permiso denegado. Elige una ciudad o marca el mapa.', locationTimeout: 'La ubicación tardó demasiado. Inténtalo de nuevo o elige una ciudad.', locationUnavailable: 'No se pudo encontrar la ubicación. Elige una ciudad o marca el mapa.' },
  fr: { locationFound: 'Position ajoutée. Les coordonnées exactes restent hors des liens partagés.', locationUnsupported: 'Position indisponible ici. Choisissez une ville ou placez un repère.', locationDenied: 'Autorisation refusée. Choisissez une ville ou placez un repère.', locationTimeout: 'La recherche a expiré. Réessayez ou choisissez une ville.', locationUnavailable: 'Position introuvable. Choisissez une ville ou placez un repère.' },
  de: { locationFound: 'Standort markiert. Genaue Koordinaten werden nicht geteilt.', locationUnsupported: 'Standort hier nicht verfügbar. Wähle eine Stadt oder setze eine Markierung.', locationDenied: 'Zugriff verweigert. Wähle eine Stadt oder setze eine Markierung.', locationTimeout: 'Standortsuche abgelaufen. Versuche es erneut oder wähle eine Stadt.', locationUnavailable: 'Standort nicht gefunden. Wähle eine Stadt oder setze eine Markierung.' },
  pt: { locationFound: 'Local marcado. As coordenadas exatas não entram nos links compartilhados.', locationUnsupported: 'Localização indisponível aqui. Escolha uma cidade ou marque o mapa.', locationDenied: 'Permissão negada. Escolha uma cidade ou marque o mapa.', locationTimeout: 'A busca expirou. Tente novamente ou escolha uma cidade.', locationUnavailable: 'Localização não encontrada. Escolha uma cidade ou marque o mapa.' },
  zh: { locationFound: '位置已标记。精确坐标不会放入分享链接。', locationUnsupported: '此处无法使用定位。请选择城市或在地图上标点。', locationDenied: '定位权限被拒绝。请选择城市或在地图上标点。', locationTimeout: '定位超时。请重试或选择城市。', locationUnavailable: '无法找到位置。请选择城市或在地图上标点。' },
  ja: { locationFound: '現在地を設定しました。正確な座標は共有リンクに含まれません。', locationUnsupported: 'この環境では位置情報を使えません。都市を選ぶか地図にピンを置いてください。', locationDenied: '位置情報の許可がありません。都市を選ぶか地図にピンを置いてください。', locationTimeout: '位置情報の取得がタイムアウトしました。再試行するか都市を選んでください。', locationUnavailable: '位置を取得できません。都市を選ぶか地図にピンを置いてください。' },
  ko: { locationFound: '위치를 표시했습니다. 정확한 좌표는 공유 링크에 포함되지 않습니다.', locationUnsupported: '이 브라우저에서는 위치를 사용할 수 없습니다. 도시를 선택하거나 지도에 표시하세요.', locationDenied: '위치 권한이 거부되었습니다. 도시를 선택하거나 지도에 표시하세요.', locationTimeout: '위치 검색 시간이 초과되었습니다. 다시 시도하거나 도시를 선택하세요.', locationUnavailable: '위치를 찾을 수 없습니다. 도시를 선택하거나 지도에 표시하세요.' },
  hi: { locationFound: 'स्थान चिह्नित है। सटीक निर्देशांक साझा लिंक में नहीं जाएंगे।', locationUnsupported: 'यहाँ स्थान उपलब्ध नहीं है। शहर चुनें या मानचित्र पर पिन लगाएँ।', locationDenied: 'स्थान की अनुमति नहीं मिली। शहर चुनें या मानचित्र पर पिन लगाएँ।', locationTimeout: 'स्थान खोजने में समय लगा। फिर कोशिश करें या शहर चुनें।', locationUnavailable: 'स्थान नहीं मिला। शहर चुनें या मानचित्र पर पिन लगाएँ।' },
  ar: { locationFound: 'تم تحديد الموقع. لن تُضاف الإحداثيات الدقيقة إلى روابط المشاركة.', locationUnsupported: 'الموقع غير متاح هنا. اختر مدينة أو ضع علامة على الخريطة.', locationDenied: 'تم رفض إذن الموقع. اختر مدينة أو ضع علامة على الخريطة.', locationTimeout: 'انتهت مهلة تحديد الموقع. أعد المحاولة أو اختر مدينة.', locationUnavailable: 'تعذر العثور على الموقع. اختر مدينة أو ضع علامة على الخريطة.' },
  it: { locationFound: 'Posizione segnata. Le coordinate precise non appaiono nei link condivisi.', locationUnsupported: 'Posizione non disponibile qui. Scegli una città o segna la mappa.', locationDenied: 'Permesso negato. Scegli una città o segna la mappa.', locationTimeout: 'Ricerca scaduta. Riprova o scegli una città.', locationUnavailable: 'Posizione non trovata. Scegli una città o segna la mappa.' },
  ru: { locationFound: 'Место отмечено. Точные координаты не попадут в ссылки.', locationUnsupported: 'Местоположение недоступно. Выберите город или отметьте точку на карте.', locationDenied: 'Доступ к местоположению запрещён. Выберите город или отметьте точку на карте.', locationTimeout: 'Время поиска истекло. Повторите попытку или выберите город.', locationUnavailable: 'Не удалось определить место. Выберите город или отметьте точку на карте.' },
  id: { locationFound: 'Lokasi ditandai. Koordinat tepat tidak disertakan dalam tautan.', locationUnsupported: 'Lokasi tidak tersedia di sini. Pilih kota atau tandai peta.', locationDenied: 'Izin lokasi ditolak. Pilih kota atau tandai peta.', locationTimeout: 'Pencarian lokasi habis waktu. Coba lagi atau pilih kota.', locationUnavailable: 'Lokasi tidak ditemukan. Pilih kota atau tandai peta.' },
  nl: { locationFound: 'Locatie gemarkeerd. Exacte coördinaten staan niet in gedeelde links.', locationUnsupported: 'Locatie is hier niet beschikbaar. Kies een stad of prik op de kaart.', locationDenied: 'Locatietoegang geweigerd. Kies een stad of prik op de kaart.', locationTimeout: 'Zoeken naar locatie duurde te lang. Probeer opnieuw of kies een stad.', locationUnavailable: 'Locatie niet gevonden. Kies een stad of prik op de kaart.' },
  tr: { locationFound: 'Konum işaretlendi. Kesin koordinatlar paylaşım bağlantısına eklenmez.', locationUnsupported: 'Konum burada kullanılamıyor. Bir şehir seçin veya haritaya işaret koyun.', locationDenied: 'Konum izni reddedildi. Bir şehir seçin veya haritaya işaret koyun.', locationTimeout: 'Konum araması zaman aşımına uğradı. Yeniden deneyin veya şehir seçin.', locationUnavailable: 'Konum bulunamadı. Bir şehir seçin veya haritaya işaret koyun.' },
  bn: { locationFound: 'অবস্থান চিহ্নিত হয়েছে। সঠিক স্থানাঙ্ক শেয়ার লিঙ্কে যাবে না।', locationUnsupported: 'এখানে অবস্থান পাওয়া যায় না। শহর বাছুন বা মানচিত্রে পিন দিন।', locationDenied: 'অবস্থানের অনুমতি নেই। শহর বাছুন বা মানচিত্রে পিন দিন।', locationTimeout: 'অবস্থান খুঁজতে সময় শেষ। আবার চেষ্টা করুন বা শহর বাছুন।', locationUnavailable: 'অবস্থান পাওয়া যায়নি। শহর বাছুন বা মানচিত্রে পিন দিন।' },
  ur: { locationFound: 'مقام نشان زد ہے۔ درست نقاط شیئر لنک میں شامل نہیں ہوں گے۔', locationUnsupported: 'یہاں مقام دستیاب نہیں۔ شہر منتخب کریں یا نقشے پر نشان لگائیں۔', locationDenied: 'مقام کی اجازت نہیں ملی۔ شہر منتخب کریں یا نقشے پر نشان لگائیں۔', locationTimeout: 'مقام تلاش کرنے کا وقت ختم ہوگیا۔ دوبارہ کوشش کریں یا شہر چنیں۔', locationUnavailable: 'مقام نہیں ملا۔ شہر منتخب کریں یا نقشے پر نشان لگائیں۔' },
  sw: { locationFound: 'Mahali pametiwa alama. Viwianishi sahihi havitawekwa kwenye kiungo.', locationUnsupported: 'Mahali hapapatikani hapa. Chagua jiji au weka alama kwenye ramani.', locationDenied: 'Ruhusa ya eneo imekataliwa. Chagua jiji au weka alama kwenye ramani.', locationTimeout: 'Utafutaji wa eneo umechukua muda mrefu. Jaribu tena au chagua jiji.', locationUnavailable: 'Mahali hapakupatikana. Chagua jiji au weka alama kwenye ramani.' },
  pl: { locationFound: 'Lokalizacja zaznaczona. Dokładne współrzędne nie trafią do linków.', locationUnsupported: 'Lokalizacja niedostępna. Wybierz miasto lub zaznacz punkt na mapie.', locationDenied: 'Brak zgody na lokalizację. Wybierz miasto lub zaznacz punkt na mapie.', locationTimeout: 'Wyszukiwanie lokalizacji trwało za długo. Spróbuj ponownie lub wybierz miasto.', locationUnavailable: 'Nie znaleziono lokalizacji. Wybierz miasto lub zaznacz punkt na mapie.' },
  uk: { locationFound: 'Місце позначено. Точні координати не потраплять у посилання.', locationUnsupported: 'Місце недоступне. Оберіть місто або позначте точку на мапі.', locationDenied: 'Доступ до місця заборонено. Оберіть місто або позначте точку на мапі.', locationTimeout: 'Час пошуку минув. Спробуйте ще раз або оберіть місто.', locationUnavailable: 'Не вдалося знайти місце. Оберіть місто або позначте точку на мапі.' },
  vi: { locationFound: 'Đã đánh dấu vị trí. Tọa độ chính xác không được đưa vào liên kết chia sẻ.', locationUnsupported: 'Không có vị trí ở đây. Hãy chọn thành phố hoặc ghim trên bản đồ.', locationDenied: 'Quyền vị trí bị từ chối. Hãy chọn thành phố hoặc ghim trên bản đồ.', locationTimeout: 'Tìm vị trí quá lâu. Hãy thử lại hoặc chọn thành phố.', locationUnavailable: 'Không tìm thấy vị trí. Hãy chọn thành phố hoặc ghim trên bản đồ.' },
  th: { locationFound: 'ปักหมุดตำแหน่งแล้ว พิกัดที่แน่นอนจะไม่อยู่ในลิงก์แชร์', locationUnsupported: 'ใช้ตำแหน่งไม่ได้ที่นี่ เลือกเมืองหรือปักหมุดบนแผนที่', locationDenied: 'ไม่ได้รับอนุญาตให้ใช้ตำแหน่ง เลือกเมืองหรือปักหมุดบนแผนที่', locationTimeout: 'ค้นหาตำแหน่งนานเกินไป ลองอีกครั้งหรือเลือกเมือง', locationUnavailable: 'ไม่พบตำแหน่ง เลือกเมืองหรือปักหมุดบนแผนที่' },
  fil: { locationFound: 'Naka-pin ang lokasyon. Hindi isasama ang eksaktong koordinado sa link.', locationUnsupported: 'Hindi available ang lokasyon. Pumili ng lungsod o mag-pin sa mapa.', locationDenied: 'Tinanggihan ang pahintulot sa lokasyon. Pumili ng lungsod o mag-pin sa mapa.', locationTimeout: 'Natagalan ang paghahanap. Subukan muli o pumili ng lungsod.', locationUnavailable: 'Hindi makita ang lokasyon. Pumili ng lungsod o mag-pin sa mapa.' },
  fa: { locationFound: 'موقعیت ثبت شد. مختصات دقیق در پیوند اشتراک‌گذاری قرار نمی‌گیرد.', locationUnsupported: 'موقعیت در دسترس نیست. شهری انتخاب کنید یا روی نقشه نشان بگذارید.', locationDenied: 'اجازهٔ موقعیت رد شد. شهری انتخاب کنید یا روی نقشه نشان بگذارید.', locationTimeout: 'زمان یافتن موقعیت تمام شد. دوباره تلاش کنید یا شهری انتخاب کنید.', locationUnavailable: 'موقعیت پیدا نشد. شهری انتخاب کنید یا روی نقشه نشان بگذارید.' },
  el: { locationFound: 'Η τοποθεσία σημειώθηκε. Οι ακριβείς συντεταγμένες δεν μπαίνουν σε συνδέσμους.', locationUnsupported: 'Η τοποθεσία δεν είναι διαθέσιμη. Επιλέξτε πόλη ή σημειώστε τον χάρτη.', locationDenied: 'Δεν δόθηκε άδεια τοποθεσίας. Επιλέξτε πόλη ή σημειώστε τον χάρτη.', locationTimeout: 'Η αναζήτηση άργησε. Δοκιμάστε ξανά ή επιλέξτε πόλη.', locationUnavailable: 'Δεν βρέθηκε τοποθεσία. Επιλέξτε πόλη ή σημειώστε τον χάρτη.' },
  he: { locationFound: 'המיקום סומן. הקואורדינטות המדויקות לא ייכללו בקישורי שיתוף.', locationUnsupported: 'המיקום אינו זמין כאן. בחרו עיר או סמנו נקודה במפה.', locationDenied: 'ההרשאה למיקום נדחתה. בחרו עיר או סמנו נקודה במפה.', locationTimeout: 'חיפוש המיקום ארך זמן רב. נסו שוב או בחרו עיר.', locationUnavailable: 'לא ניתן למצוא את המיקום. בחרו עיר או סמנו נקודה במפה.' },
  sv: { locationFound: 'Platsen är markerad. Exakta koordinater delas inte i länkar.', locationUnsupported: 'Plats är inte tillgänglig här. Välj en stad eller markera kartan.', locationDenied: 'Platsbehörighet nekades. Välj en stad eller markera kartan.', locationTimeout: 'Det tog för lång tid att hitta platsen. Försök igen eller välj stad.', locationUnavailable: 'Platsen kunde inte hittas. Välj en stad eller markera kartan.' },
  ta: { locationFound: 'இடம் குறிக்கப்பட்டது. துல்லியமான ஆயத்தொலைவுகள் பகிர்வு இணைப்பில் சேராது.', locationUnsupported: 'இங்கு இருப்பிடம் கிடைக்கவில்லை. நகரத்தைத் தேர்ந்தெடுக்கவும் அல்லது வரைபடத்தில் குறிக்கவும்.', locationDenied: 'இருப்பிட அனுமதி மறுக்கப்பட்டது. நகரத்தைத் தேர்ந்தெடுக்கவும் அல்லது வரைபடத்தில் குறிக்கவும்.', locationTimeout: 'இருப்பிடத் தேடல் காலாவதியானது. மீண்டும் முயற்சிக்கவும் அல்லது நகரத்தைத் தேர்ந்தெடுக்கவும்.', locationUnavailable: 'இருப்பிடத்தைக் கண்டறிய முடியவில்லை. நகரத்தைத் தேர்ந்தெடுக்கவும் அல்லது வரைபடத்தில் குறிக்கவும்.' },
  te: { locationFound: 'స్థానం గుర్తించబడింది. ఖచ్చితమైన కోఆర్డినేట్లు షేర్ లింక్‌లో ఉండవు.', locationUnsupported: 'ఇక్కడ స్థానం అందుబాటులో లేదు. నగరాన్ని ఎంచుకోండి లేదా మ్యాప్‌పై గుర్తించండి.', locationDenied: 'స్థాన అనుమతి నిరాకరించబడింది. నగరాన్ని ఎంచుకోండి లేదా మ్యాప్‌పై గుర్తించండి.', locationTimeout: 'స్థాన శోధన సమయం ముగిసింది. మళ్లీ ప్రయత్నించండి లేదా నగరాన్ని ఎంచుకోండి.', locationUnavailable: 'స్థానం కనుగొనబడలేదు. నగరాన్ని ఎంచుకోండి లేదా మ్యాప్‌పై గుర్తించండి.' },
  ms: { locationFound: 'Lokasi ditanda. Koordinat tepat tidak dimasukkan dalam pautan.', locationUnsupported: 'Lokasi tidak tersedia di sini. Pilih bandar atau tandakan peta.', locationDenied: 'Kebenaran lokasi ditolak. Pilih bandar atau tandakan peta.', locationTimeout: 'Carian lokasi tamat masa. Cuba lagi atau pilih bandar.', locationUnavailable: 'Lokasi tidak ditemukan. Pilih bandar atau tandakan peta.' },
}
const readingInterfaceTranslations: Partial<Record<Language, Partial<Record<MessageKey, string>>>> = {
  es: { kicker: 'DATOS DE LA TIERRA NASA / ATLAS INTERACTIVO', projectSummary: 'Explora la ciencia de la Tierra de NASA con mapas interactivos, lecturas claras y explicaciones sencillas.', dataSnapshot: 'Últimos datos de NASA', chooseWeatherLayer: 'Elige una vista del tiempo', hoverToRead: 'Pasa el cursor para ver las lecturas', whatThisReadingMeans: 'Qué significa esta lectura', globeHelp: 'Gira el globo, amplía, busca una ciudad o pasa el cursor para ver mediciones. Haz clic para fijar un punto y consultar el valor de NASA.', loadingRecord: 'Cargando mediciones de NASA…', documentTitle: 'Field Force — Explora los datos de la Tierra de NASA', documentDescription: 'Mapa interactivo de datos de NASA con lecturas claras y explicaciones sencillas.' },
  fr: { kicker: 'DONNÉES TERRESTRES NASA / ATLAS INTERACTIF', projectSummary: 'Explorez les sciences de la Terre de la NASA avec des cartes interactives, des mesures claires et des explications simples.', dataSnapshot: 'Dernières données NASA', chooseWeatherLayer: 'Choisir une vue météo', hoverToRead: 'Survolez la carte pour voir les mesures', whatThisReadingMeans: 'Que signifie cette mesure ?', globeHelp: 'Faites tourner le globe, zoomez, cherchez une ville ou survolez la carte pour voir les mesures. Cliquez pour choisir un point et lire la valeur NASA.', loadingRecord: 'Chargement des mesures NASA…', documentTitle: 'Field Force — Données NASA sur la Terre', documentDescription: 'Carte interactive des données NASA avec des mesures claires et des explications simples.' },
  de: { kicker: 'NASA ERDDATEN / INTERAKTIVER ATLAS', projectSummary: 'Erkunde die NASA-Erdwissenschaft mit interaktiven Karten, klaren Messwerten und einfachen Erklärungen.', dataSnapshot: 'Neueste NASA-Daten', chooseWeatherLayer: 'Wetteransicht wählen', hoverToRead: 'Mit der Maus Messwerte ansehen', whatThisReadingMeans: 'Bedeutung dieses Messwerts', globeHelp: 'Drehe den Globus, zoome, suche eine Stadt oder bewege die Maus über die Karte. Klicke auf einen Punkt, um den NASA-Messwert zu lesen.', loadingRecord: 'NASA-Messwerte werden geladen…', documentTitle: 'Field Force — NASA-Erdendaten', documentDescription: 'Interaktive NASA-Karte mit klaren Messwerten und einfachen Erklärungen.' },
  pt: { kicker: 'DADOS DA TERRA NASA / ATLAS INTERATIVO', projectSummary: 'Explore a ciência da Terra da NASA com mapas interativos, leituras claras e explicações simples.', dataSnapshot: 'Dados NASA mais recentes', chooseWeatherLayer: 'Escolher vista do tempo', hoverToRead: 'Passe o cursor para ver as leituras', whatThisReadingMeans: 'O que esta leitura significa', globeHelp: 'Gire o globo, amplie, procure uma cidade ou passe o cursor para ver medições. Clique para marcar um ponto e ler o valor da NASA.', loadingRecord: 'Carregando medições da NASA…', documentTitle: 'Field Force — Dados da Terra da NASA', documentDescription: 'Mapa interativo da NASA com leituras claras e explicações simples.' },
  zh: { kicker: 'NASA 地球数据 / 互动地图集', projectSummary: '通过互动地图、清晰读数和简明说明，探索 NASA 地球科学。', dataSnapshot: '最新 NASA 数据', chooseWeatherLayer: '选择天气视图', hoverToRead: '将鼠标移到地图上查看读数', whatThisReadingMeans: '此读数的含义', globeHelp: '旋转地球、缩放、查找城市，或将鼠标移到地图上查看测量值。点击地图可标记位置并查看 NASA 数据。', loadingRecord: '正在加载 NASA 测量数据…', documentTitle: 'Field Force — NASA 地球数据', documentDescription: '互动 NASA 地球数据地图，提供清晰读数和简明说明。' },
  ja: { kicker: 'NASA地球データ / インタラクティブアトラス', projectSummary: 'インタラクティブな地図、わかりやすい数値、簡潔な説明でNASAの地球科学を探ります。', dataSnapshot: '最新のNASAデータ', chooseWeatherLayer: '天気表示を選択', hoverToRead: '地図にカーソルを合わせて数値を表示', whatThisReadingMeans: 'この数値の意味', globeHelp: '地球を回転・拡大し、都市を検索できます。地図にカーソルを合わせると測定値が表示されます。クリックして地点を選び、NASAの値を確認してください。', loadingRecord: 'NASAの測定値を読み込み中…', documentTitle: 'Field Force — NASA地球データ', documentDescription: 'わかりやすい測定値と説明を備えたNASA地球データのインタラクティブ地図。' },
  ko: { kicker: 'NASA 지구 데이터 / 인터랙티브 지도', projectSummary: '인터랙티브 지도와 명확한 측정값, 쉬운 설명으로 NASA 지구 과학을 살펴보세요.', dataSnapshot: '최신 NASA 데이터', chooseWeatherLayer: '날씨 보기 선택', hoverToRead: '지도에 마우스를 올려 측정값 확인', whatThisReadingMeans: '이 측정값의 의미', globeHelp: '지구본을 회전하고 확대하거나 도시를 찾으세요. 지도에 마우스를 올리면 측정값을 볼 수 있습니다. 클릭해 위치를 고정하고 NASA 값을 확인하세요.', loadingRecord: 'NASA 측정값을 불러오는 중…', documentTitle: 'Field Force — NASA 지구 데이터', documentDescription: '명확한 측정값과 쉬운 설명을 제공하는 NASA 지구 데이터 인터랙티브 지도.' },
  hi: { kicker: 'NASA पृथ्वी डेटा / इंटरैक्टिव एटलस', projectSummary: 'इंटरैक्टिव मानचित्रों, स्पष्ट माप और सरल व्याख्याओं से NASA के पृथ्वी विज्ञान को जानें।', dataSnapshot: 'नवीनतम NASA डेटा', chooseWeatherLayer: 'मौसम दृश्य चुनें', hoverToRead: 'माप देखने के लिए मानचित्र पर कर्सर रखें', whatThisReadingMeans: 'इस माप का अर्थ', globeHelp: 'ग्लोब घुमाएँ, ज़ूम करें, शहर खोजें या माप देखने के लिए मानचित्र पर कर्सर रखें। NASA का मान पढ़ने के लिए किसी स्थान पर क्लिक करें।', loadingRecord: 'NASA के माप लोड हो रहे हैं…', documentTitle: 'Field Force — NASA पृथ्वी डेटा', documentDescription: 'स्पष्ट माप और सरल व्याख्याओं वाला NASA का इंटरैक्टिव पृथ्वी मानचित्र।' },
  ar: { kicker: 'بيانات الأرض من ناسا / أطلس تفاعلي', projectSummary: 'استكشف علوم الأرض لدى ناسا عبر خرائط تفاعلية وقراءات واضحة وشروحات بسيطة.', dataSnapshot: 'أحدث بيانات ناسا', chooseWeatherLayer: 'اختر عرض الطقس', hoverToRead: 'مرر المؤشر على الخريطة لعرض القياسات', whatThisReadingMeans: 'معنى هذه القراءة', globeHelp: 'أدر الكرة وكبّر العرض وابحث عن مدينة أو مرر المؤشر لرؤية القياسات. انقر لتحديد موقع وقراءة قيمة ناسا.', loadingRecord: 'جارٍ تحميل قياسات ناسا…', documentTitle: 'Field Force — بيانات الأرض من ناسا', documentDescription: 'خريطة تفاعلية لبيانات الأرض من ناسا مع قراءات وشروحات واضحة.' },
  it: { kicker: 'DATI TERRESTRI NASA / ATLANTE INTERATTIVO', projectSummary: 'Esplora le scienze della Terra NASA con mappe interattive, misure chiare e spiegazioni semplici.', dataSnapshot: 'Ultimi dati NASA', chooseWeatherLayer: 'Scegli la vista meteo', hoverToRead: 'Passa sulla mappa per vedere le misure', whatThisReadingMeans: 'Significato di questa lettura', globeHelp: 'Ruota il globo, ingrandisci, cerca una città o passa sulla mappa per vedere le misure. Fai clic per selezionare un punto e leggere il valore NASA.', loadingRecord: 'Caricamento delle misure NASA…', documentTitle: 'Field Force — Dati NASA sulla Terra', documentDescription: 'Mappa interattiva NASA con misure chiare e spiegazioni semplici.' },
  ru: { kicker: 'ДАННЫЕ NASA О ЗЕМЛЕ / ИНТЕРАКТИВНЫЙ АТЛАС', projectSummary: 'Изучайте науку NASA о Земле с помощью интерактивных карт, понятных значений и простых пояснений.', dataSnapshot: 'Последние данные NASA', chooseWeatherLayer: 'Выбрать погодный слой', hoverToRead: 'Наведите курсор на карту, чтобы увидеть значения', whatThisReadingMeans: 'Что означает это значение', globeHelp: 'Вращайте глобус, меняйте масштаб, ищите город или наведите курсор на карту. Нажмите, чтобы выбрать точку и прочитать значение NASA.', loadingRecord: 'Загрузка измерений NASA…', documentTitle: 'Field Force — данные NASA о Земле', documentDescription: 'Интерактивная карта данных NASA с понятными значениями и пояснениями.' },
  id: { kicker: 'DATA BUMI NASA / ATLAS INTERAKTIF', projectSummary: 'Jelajahi ilmu Bumi NASA dengan peta interaktif, nilai yang jelas, dan penjelasan sederhana.', dataSnapshot: 'Data NASA terbaru', chooseWeatherLayer: 'Pilih tampilan cuaca', hoverToRead: 'Arahkan kursor ke peta untuk melihat nilai', whatThisReadingMeans: 'Arti pembacaan ini', globeHelp: 'Putar globe, perbesar, cari kota, atau arahkan kursor ke peta untuk melihat pengukuran. Klik untuk memilih titik dan membaca nilai NASA.', loadingRecord: 'Memuat pengukuran NASA…', documentTitle: 'Field Force — Data Bumi NASA', documentDescription: 'Peta interaktif data NASA dengan nilai yang jelas dan penjelasan sederhana.' },
  nl: { kicker: 'NASA AARDGEGEVENS / INTERACTIEVE ATLAS', projectSummary: 'Ontdek NASA-aardwetenschap met interactieve kaarten, duidelijke metingen en eenvoudige uitleg.', dataSnapshot: 'Nieuwste NASA-gegevens', chooseWeatherLayer: 'Weerweergave kiezen', hoverToRead: 'Beweeg over de kaart om metingen te bekijken', whatThisReadingMeans: 'Wat deze meting betekent', globeHelp: 'Draai de globe, zoom in, zoek een stad of beweeg over de kaart om metingen te zien. Klik om een punt vast te zetten en de NASA-waarde te lezen.', loadingRecord: 'NASA-metingen laden…', documentTitle: 'Field Force — NASA-aardgegevens', documentDescription: 'Interactieve NASA-kaart met duidelijke metingen en eenvoudige uitleg.' },
  tr: { kicker: 'NASA DÜNYA VERİLERİ / ETKİLEŞİMLİ ATLAS', projectSummary: 'NASA Dünya bilimini etkileşimli haritalar, anlaşılır ölçümler ve sade açıklamalarla keşfedin.', dataSnapshot: 'En güncel NASA verileri', chooseWeatherLayer: 'Hava durumu görünümünü seç', hoverToRead: 'Ölçümleri görmek için haritanın üzerine gelin', whatThisReadingMeans: 'Bu ölçümün anlamı', globeHelp: 'Küreyi döndürün, yakınlaştırın, şehir arayın veya ölçümleri görmek için haritanın üzerine gelin. Bir konumu sabitleyip NASA değerini okumak için tıklayın.', loadingRecord: 'NASA ölçümleri yükleniyor…', documentTitle: 'Field Force — NASA Dünya verileri', documentDescription: 'Anlaşılır ölçümler ve açıklamalar içeren etkileşimli NASA Dünya haritası.' },
  bn: { kicker: 'NASA পৃথিবী তথ্য / ইন্টারঅ্যাকটিভ অ্যাটলাস', projectSummary: 'ইন্টারঅ্যাকটিভ মানচিত্র, স্পষ্ট পরিমাপ এবং সহজ ব্যাখ্যার মাধ্যমে NASA-র পৃথিবী বিজ্ঞান জানুন।', dataSnapshot: 'সর্বশেষ NASA তথ্য', chooseWeatherLayer: 'আবহাওয়ার দৃশ্য বাছুন', hoverToRead: 'পরিমাপ দেখতে মানচিত্রে কার্সর রাখুন', whatThisReadingMeans: 'এই পাঠের অর্থ', globeHelp: 'গ্লোব ঘোরান, বড় করুন, শহর খুঁজুন বা পরিমাপ দেখতে মানচিত্রে কার্সর রাখুন। NASA-র মান পড়তে একটি অবস্থানে ক্লিক করুন।', loadingRecord: 'NASA-র পরিমাপ লোড হচ্ছে…', documentTitle: 'Field Force — NASA পৃথিবী তথ্য', documentDescription: 'স্পষ্ট পরিমাপ ও সহজ ব্যাখ্যাসহ NASA-র ইন্টারঅ্যাকটিভ পৃথিবী মানচিত্র।' },
  ur: { kicker: 'NASA زمین کا ڈیٹا / انٹرایکٹو اٹلس', projectSummary: 'انٹرایکٹو نقشوں، واضح پیمائشوں اور آسان وضاحتوں سے NASA کی زمینی سائنس دیکھیں۔', dataSnapshot: 'NASA کا تازہ ترین ڈیٹا', chooseWeatherLayer: 'موسم کا منظر منتخب کریں', hoverToRead: 'پیمائشیں دیکھنے کے لیے نقشے پر کرسر رکھیں', whatThisReadingMeans: 'اس پیمائش کا مطلب', globeHelp: 'گلوب گھمائیں، زوم کریں، شہر تلاش کریں یا پیمائشیں دیکھنے کے لیے نقشے پر کرسر رکھیں۔ NASA کی قدر پڑھنے کے لیے مقام پر کلک کریں۔', loadingRecord: 'NASA کی پیمائشیں لوڈ ہو رہی ہیں…', documentTitle: 'Field Force — NASA زمین کا ڈیٹا', documentDescription: 'واضح پیمائشوں اور آسان وضاحتوں والا NASA کا انٹرایکٹو نقشہ۔' },
  sw: { kicker: 'DATA ZA DUNIA YA NASA / RAMANI SHIRIKISHI', projectSummary: 'Chunguza sayansi ya Dunia ya NASA kwa ramani shirikishi, vipimo wazi na maelezo rahisi.', dataSnapshot: 'Data mpya zaidi za NASA', chooseWeatherLayer: 'Chagua mwonekano wa hali ya hewa', hoverToRead: 'Elekeza kipanya kwenye ramani kuona vipimo', whatThisReadingMeans: 'Maana ya kipimo hiki', globeHelp: 'Zungusha dunia, vuta karibu, tafuta mji au elekeza kipanya kwenye ramani kuona vipimo. Bofya kuweka alama na kusoma thamani ya NASA.', loadingRecord: 'Inapakia vipimo vya NASA…', documentTitle: 'Field Force — Data za Dunia za NASA', documentDescription: 'Ramani shirikishi ya NASA yenye vipimo wazi na maelezo rahisi.' },
  pl: { kicker: 'DANE NASA O ZIEMI / INTERAKTYWNY ATLAS', projectSummary: 'Poznawaj naukę NASA o Ziemi dzięki interaktywnym mapom, czytelnym pomiarom i prostym objaśnieniom.', dataSnapshot: 'Najnowsze dane NASA', chooseWeatherLayer: 'Wybierz widok pogody', hoverToRead: 'Najedź na mapę, aby zobaczyć pomiary', whatThisReadingMeans: 'Co oznacza ten odczyt', globeHelp: 'Obracaj globus, przybliżaj, szukaj miasta lub najedź na mapę, aby zobaczyć pomiary. Kliknij punkt, aby odczytać wartość NASA.', loadingRecord: 'Wczytywanie pomiarów NASA…', documentTitle: 'Field Force — dane NASA o Ziemi', documentDescription: 'Interaktywna mapa NASA z czytelnymi pomiarami i prostymi objaśnieniami.' },
  uk: { kicker: 'ДАНІ NASA ПРО ЗЕМЛЮ / ІНТЕРАКТИВНИЙ АТЛАС', projectSummary: 'Досліджуйте науку NASA про Землю за допомогою інтерактивних карт, зрозумілих вимірювань і простих пояснень.', dataSnapshot: 'Найновіші дані NASA', chooseWeatherLayer: 'Оберіть погодний шар', hoverToRead: 'Наведіть курсор на карту, щоб побачити вимірювання', whatThisReadingMeans: 'Що означає це вимірювання', globeHelp: 'Обертайте глобус, змінюйте масштаб, шукайте місто або наведіть курсор на карту. Натисніть, щоб позначити точку й прочитати значення NASA.', loadingRecord: 'Завантаження вимірювань NASA…', documentTitle: 'Field Force — дані NASA про Землю', documentDescription: 'Інтерактивна карта NASA зі зрозумілими вимірюваннями та поясненнями.' },
  vi: { kicker: 'DỮ LIỆU TRÁI ĐẤT NASA / BẢN ĐỒ TƯƠNG TÁC', projectSummary: 'Khám phá khoa học Trái Đất của NASA qua bản đồ tương tác, số đo rõ ràng và giải thích dễ hiểu.', dataSnapshot: 'Dữ liệu NASA mới nhất', chooseWeatherLayer: 'Chọn lớp thời tiết', hoverToRead: 'Di chuột trên bản đồ để xem số đo', whatThisReadingMeans: 'Ý nghĩa của số đo này', globeHelp: 'Xoay địa cầu, phóng to, tìm thành phố hoặc di chuột trên bản đồ để xem số đo. Nhấp để ghim vị trí và đọc giá trị NASA.', loadingRecord: 'Đang tải số đo NASA…', documentTitle: 'Field Force — Dữ liệu Trái Đất NASA', documentDescription: 'Bản đồ dữ liệu NASA tương tác với số đo rõ ràng và giải thích dễ hiểu.' },
  th: { kicker: 'ข้อมูลโลกของ NASA / แอตลาสแบบโต้ตอบ', projectSummary: 'สำรวจวิทยาศาสตร์โลกของ NASA ด้วยแผนที่โต้ตอบ ค่าที่อ่านง่าย และคำอธิบายที่เข้าใจง่าย', dataSnapshot: 'ข้อมูล NASA ล่าสุด', chooseWeatherLayer: 'เลือกมุมมองสภาพอากาศ', hoverToRead: 'เลื่อนเมาส์บนแผนที่เพื่อดูค่า', whatThisReadingMeans: 'ความหมายของค่านี้', globeHelp: 'หมุนโลก ซูม ค้นหาเมือง หรือเลื่อนเมาส์บนแผนที่เพื่อดูค่า คลิกเพื่อปักหมุดและอ่านค่าจาก NASA', loadingRecord: 'กำลังโหลดค่าจาก NASA…', documentTitle: 'Field Force — ข้อมูลโลก NASA', documentDescription: 'แผนที่ข้อมูล NASA แบบโต้ตอบ พร้อมค่าที่อ่านง่ายและคำอธิบายชัดเจน' },
  fil: { kicker: 'DATOS NG LUPA NG NASA / INTERAKTIBONG ATLAS', projectSummary: 'Tuklasin ang agham ng Daigdig ng NASA gamit ang interaktibong mapa, malinaw na sukat, at payak na paliwanag.', dataSnapshot: 'Pinakabagong datos ng NASA', chooseWeatherLayer: 'Pumili ng tanawin ng panahon', hoverToRead: 'Itapat ang cursor sa mapa upang makita ang sukat', whatThisReadingMeans: 'Kahulugan ng sukat na ito', globeHelp: 'Iikot at i-zoom ang globo, maghanap ng lungsod, o itapat ang cursor sa mapa para makita ang sukat. Mag-click upang pumili ng lokasyon at basahin ang halaga ng NASA.', loadingRecord: 'Kinakarga ang mga sukat ng NASA…', documentTitle: 'Field Force — Datos ng Lupa ng NASA', documentDescription: 'Interaktibong mapa ng datos ng NASA na may malinaw na sukat at paliwanag.' },
  fa: { kicker: 'داده‌های زمین ناسا / اطلس تعاملی', projectSummary: 'با نقشه‌های تعاملی، اندازه‌گیری‌های روشن و توضیح‌های ساده، علوم زمین ناسا را کاوش کنید.', dataSnapshot: 'تازه‌ترین داده‌های ناسا', chooseWeatherLayer: 'نمای آب‌وهوا را انتخاب کنید', hoverToRead: 'برای دیدن اندازه‌گیری‌ها روی نقشه مکث کنید', whatThisReadingMeans: 'معنای این اندازه‌گیری', globeHelp: 'کره را بچرخانید، بزرگ‌نمایی کنید، شهری را جست‌وجو کنید یا برای دیدن اندازه‌گیری‌ها روی نقشه مکث کنید. برای خواندن مقدار ناسا روی نقطه کلیک کنید.', loadingRecord: 'اندازه‌گیری‌های ناسا در حال بارگیری است…', documentTitle: 'Field Force — داده‌های زمین ناسا', documentDescription: 'نقشه تعاملی ناسا با اندازه‌گیری‌های روشن و توضیح‌های ساده.' },
  el: { kicker: 'ΔΕΔΟΜΕΝΑ ΓΗΣ NASA / ΔΙΑΔΡΑΣΤΙΚΟΣ ΑΤΛΑΣ', projectSummary: 'Εξερευνήστε την επιστήμη της NASA για τη Γη με διαδραστικούς χάρτες, σαφείς μετρήσεις και απλές εξηγήσεις.', dataSnapshot: 'Νεότερα δεδομένα NASA', chooseWeatherLayer: 'Επιλογή προβολής καιρού', hoverToRead: 'Περάστε τον δείκτη πάνω από τον χάρτη για μετρήσεις', whatThisReadingMeans: 'Τι σημαίνει αυτή η μέτρηση', globeHelp: 'Περιστρέψτε την υδρόγειο, κάντε ζουμ, βρείτε πόλη ή περάστε τον δείκτη πάνω από τον χάρτη. Κάντε κλικ για να επιλέξετε σημείο και να δείτε την τιμή NASA.', loadingRecord: 'Φόρτωση μετρήσεων NASA…', documentTitle: 'Field Force — δεδομένα NASA για τη Γη', documentDescription: 'Διαδραστικός χάρτης NASA με σαφείς μετρήσεις και απλές εξηγήσεις.' },
  he: { kicker: 'נתוני כדור הארץ של NASA / אטלס אינטראקטיבי', projectSummary: 'חקרו את מדעי כדור הארץ של NASA באמצעות מפות אינטראקטיביות, מדידות ברורות והסברים פשוטים.', dataSnapshot: 'נתוני NASA העדכניים', chooseWeatherLayer: 'בחירת תצוגת מזג אוויר', hoverToRead: 'העבירו את הסמן מעל המפה כדי לראות מדידות', whatThisReadingMeans: 'מה משמעות המדידה הזו', globeHelp: 'סובבו את כדור הארץ, הגדילו, חפשו עיר או העבירו את הסמן מעל המפה כדי לראות מדידות. לחצו כדי לבחור נקודה ולקרוא את ערך NASA.', loadingRecord: 'טוען מדידות NASA…', documentTitle: 'Field Force — נתוני כדור הארץ של NASA', documentDescription: 'מפת NASA אינטראקטיבית עם מדידות ברורות והסברים פשוטים.' },
  sv: { kicker: 'NASA JORDDATA / INTERAKTIV ATLAS', projectSummary: 'Utforska NASA:s jordvetenskap med interaktiva kartor, tydliga mätvärden och enkla förklaringar.', dataSnapshot: 'Senaste NASA-data', chooseWeatherLayer: 'Välj vädervy', hoverToRead: 'Håll pekaren över kartan för att se mätvärden', whatThisReadingMeans: 'Vad mätvärdet betyder', globeHelp: 'Rotera jordklotet, zooma, sök efter en stad eller håll pekaren över kartan för att se mätvärden. Klicka för att välja en plats och läsa NASA-värdet.', loadingRecord: 'Läser in NASA-mätningar…', documentTitle: 'Field Force — NASA:s jorddata', documentDescription: 'Interaktiv NASA-karta med tydliga mätvärden och enkla förklaringar.' },
  ta: { kicker: 'NASA பூமித் தரவு / ஊடாடும் அட்லஸ்', projectSummary: 'ஊடாடும் வரைபடங்கள், தெளிவான அளவீடுகள், எளிய விளக்கங்கள் மூலம் NASA பூமி அறிவியலை ஆராயுங்கள்.', dataSnapshot: 'சமீபத்திய NASA தரவு', chooseWeatherLayer: 'வானிலை காட்சியைத் தேர்ந்தெடுக்கவும்', hoverToRead: 'அளவீடுகளைக் காண வரைபடத்தின் மீது சுட்டியை வைக்கவும்', whatThisReadingMeans: 'இந்த அளவீட்டின் பொருள்', globeHelp: 'பூமியைச் சுழற்றவும், பெரிதாக்கவும், நகரத்தைத் தேடவும் அல்லது அளவீடுகளைக் காண வரைபடத்தின் மீது சுட்டியை வைக்கவும். NASA மதிப்பைப் படிக்க இடத்தைத் தேர்ந்தெடுக்கவும்.', loadingRecord: 'NASA அளவீடுகள் ஏற்றப்படுகின்றன…', documentTitle: 'Field Force — NASA பூமித் தரவு', documentDescription: 'தெளிவான அளவீடுகள் மற்றும் எளிய விளக்கங்களுடன் NASA ஊடாடும் வரைபடம்.' },
  te: { kicker: 'NASA భూమి డేటా / ఇంటరాక్టివ్ అట్లాస్', projectSummary: 'ఇంటరాక్టివ్ మ్యాప్‌లు, స్పష్టమైన కొలతలు, సులభమైన వివరణలతో NASA భూమి విజ్ఞానాన్ని అన్వేషించండి.', dataSnapshot: 'తాజా NASA డేటా', chooseWeatherLayer: 'వాతావరణ వీక్షణను ఎంచుకోండి', hoverToRead: 'కొలతలు చూడటానికి మ్యాప్‌పై కర్సర్ ఉంచండి', whatThisReadingMeans: 'ఈ కొలత అర్థం', globeHelp: 'భూగోళాన్ని తిప్పండి, జూమ్ చేయండి, నగరాన్ని వెతకండి లేదా కొలతలు చూడటానికి మ్యాప్‌పై కర్సర్ ఉంచండి. NASA విలువను చదవడానికి స్థలాన్ని ఎంచుకోండి.', loadingRecord: 'NASA కొలతలు లోడ్ అవుతున్నాయి…', documentTitle: 'Field Force — NASA భూమి డేటా', documentDescription: 'స్పష్టమైన కొలతలు, సులభమైన వివరణలతో NASA ఇంటరాక్టివ్ మ్యాప్.' },
  ms: { kicker: 'DATA BUMI NASA / ATLAS INTERAKTIF', projectSummary: 'Terokai sains Bumi NASA melalui peta interaktif, bacaan yang jelas dan penerangan mudah.', dataSnapshot: 'Data NASA terkini', chooseWeatherLayer: 'Pilih paparan cuaca', hoverToRead: 'Tuding pada peta untuk melihat bacaan', whatThisReadingMeans: 'Maksud bacaan ini', globeHelp: 'Putar glob, zum, cari bandar atau tuding pada peta untuk melihat ukuran. Klik untuk memilih lokasi dan membaca nilai NASA.', loadingRecord: 'Memuatkan ukuran NASA…', documentTitle: 'Field Force — Data Bumi NASA', documentDescription: 'Peta interaktif NASA dengan bacaan yang jelas dan penerangan mudah.' },
}
const loadedLocales = new Map<Language, LocaleBundle>([['en', englishLocale]])
const datasetLabelSources: Partial<Record<DatasetKey, string>> = {
  weather: 'Weather',
  'land-temperature': 'Land temp',
  productivity: 'Plant growth',
  humidity: 'Humidity',
  'specific-humidity': 'Specific humidity',
  'cloud-cover': 'Cloud cover',
  'solar-radiation': 'Solar radiation',
  'longwave-radiation': 'Longwave radiation',
  'aerosol-depth': 'Aerosol depth',
  'surface-pressure': 'Surface pressure',
  'air-temperature': 'Air temperature',
  'min-air-temperature': 'Daily low',
  'max-air-temperature': 'Daily high',
  'temperature-range': 'Daily temperature range',
  'wet-bulb-temperature': 'Wet-bulb temp',
  'dew-point': 'Dew / frost point',
  'precipitable-water': 'Precipitable water',
  'soil-wetness': 'Soil wetness',
  'land-evaporation': 'Land evaporation',
  'transpiration-energy': 'Transpiration energy',
  'wind-speed-2m': '2 m wind speed',
}

function repairText(text: string): string {
  const replacements: Array<[string, string]> = [
    [String.fromCharCode(194, 183), String.fromCharCode(183)],
    [String.fromCharCode(194, 176), String.fromCharCode(176)],
    [String.fromCharCode(194, 178), String.fromCharCode(178)],
    [String.fromCharCode(226, 8364, 8220), String.fromCharCode(8211)],
    [String.fromCharCode(226, 8364, 8221), String.fromCharCode(8212)],
    [String.fromCharCode(226, 8364, 166), String.fromCharCode(8230)],
    [String.fromCharCode(226, 8240, 163), String.fromCharCode(8805)],
    [String.fromCharCode(226, 8224, 8221), String.fromCharCode(8596)],
    [String.fromCharCode(226, 8224, 8217), String.fromCharCode(8594)],
    [String.fromCharCode(226, 338, 129), String.fromCodePoint(8961)],
    [String.fromCharCode(226, 8218, 8218), String.fromCharCode(8322)],
    [String.fromCharCode(195, 151), String.fromCharCode(215)],
  ]
  return replacements.reduce((result, [broken, corrected]) => result.split(broken).join(corrected), text)
}

interface I18nContextValue {
  language: Language
  setLanguage: (language: Language) => void
  t: (key: MessageKey, values?: Record<string, string | number>) => string
  tx: (text: string) => string
  datasetName: (dataset: DatasetKey) => string
}

const I18nContext = createContext<I18nContextValue | null>(null)

function compilePattern(source: string, target: string) {
  source = repairText(source)
  target = repairText(target)
  const markers = source.match(/ZXQPHRASE\d+QXZ/g) ?? []
  if (!markers.length) return null
  let cursor = 0
  let expression = '^'
  for (const marker of markers) {
    const index = source.indexOf(marker, cursor)
    expression += source.slice(cursor, index).replace(/[.*+?^$()|[\]{}\\]/g, '\\$&') + '([\\s\\S]*?)'
    cursor = index + marker.length
  }
  expression += source.slice(cursor).replace(/[.*+?^$()|[\]{}\\]/g, '\\$&') + '$'
  return { source, target, markers, expression: new RegExp(expression) }
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  // Read the stored choice once. Re-reading localStorage on every render lets
  // the previous locale re-enter the startup effect before the new choice is saved.
  const [initialLanguage] = useState<Language>(() => {
    const savedLanguage = readPreference('listening-planet.language')
    return languages.some((item) => item.code === savedLanguage) ? savedLanguage as Language : 'en'
  })
  const [language, setLanguageState] = useState<Language>(initialLanguage)
  const [bundle, setBundle] = useState<LocaleBundle>(englishLocale)
  const [localeReady, setLocaleReady] = useState(initialLanguage === 'en')
  const requestId = useRef(0)

  useEffect(() => {
    let active = true
    const request = ++requestId.current
    if (initialLanguage !== 'en') {
      const cached = loadedLocales.get(initialLanguage)
      const loader = localeLoaders[initialLanguage]
      if (cached) {
        if (request === requestId.current) {
          setBundle(cached)
          setLocaleReady(true)
        }
      }
      else if (loader) {
        loader().then((loaded) => {
          loadedLocales.set(initialLanguage, loaded)
          if (active && request === requestId.current) {
            setBundle(loaded)
            setLocaleReady(true)
          }
        }).catch(() => {
          if (active && request === requestId.current) {
            setLanguageState('en')
            setBundle(englishLocale)
            setLocaleReady(true)
          }
        })
      }
    }
    return () => { active = false }
  }, [initialLanguage])

  const setLanguage = useCallback((nextLanguage: Language) => {
    const request = ++requestId.current
    if (nextLanguage === 'en') {
      setBundle(englishLocale)
      setLanguageState('en')
      setLocaleReady(true)
      return
    }
    const cached = loadedLocales.get(nextLanguage)
    const loader = localeLoaders[nextLanguage]
    const load = cached ? Promise.resolve(cached) : loader?.()
    if (!load) return
    void load.then((loaded) => {
      loadedLocales.set(nextLanguage, loaded)
      if (request !== requestId.current) return
      setBundle(loaded)
      setLanguageState(nextLanguage)
    }).catch(() => {
      if (request !== requestId.current) return
      setBundle(englishLocale)
      setLanguageState('en')
    })
  }, [])

  const t = useCallback((key: MessageKey, values: Record<string, string | number> = {}) => {
    const message = readingInterfaceTranslations[language]?.[key]
      ?? locationMessageTranslations[language]?.[key]
      ?? featureMessageTranslations[language]?.[key]
      ?? bundle.messages[key]
      ?? englishLocale.messages[key]
    return repairText(message.replace(/\{(\w+)\}/g, (_match, name: string) => String(values[name] ?? '{' + name + '}')))
  }, [bundle, language])

  const patterns = useMemo(() => (bundle.patterns as Pattern[])
    .map((item) => compilePattern(item.source, item.target))
    .filter((item): item is NonNullable<typeof item> => item !== null)
    .sort((first, second) => second.source.length - first.source.length), [bundle])

  const contentLookup = useMemo(() => {
    const lookup = new Map<string, string>()
    for (const [key, value] of Object.entries(bundle.content as Record<string, string>)) {
      lookup.set(key, value)
      lookup.set(repairText(key), value)
    }
    return lookup
  }, [bundle])

  const tx = useCallback((text: string) => {
    const leading = text.match(/^\s*/)?.[0] ?? ''
    const trailing = text.match(/\s*$/)?.[0] ?? ''
    const source = repairText(text.trim().replace(/\s+/g, ' '))
    if (!source) return text
    const direct = contentLookup.get(source)
    if (direct) return repairText(leading + direct + trailing)
    for (const item of patterns) {
      const match = item.expression.exec(source)
      if (!match) continue
      let translated = item.target
      item.markers.forEach((marker, index) => { translated = translated.replace(marker, match[index + 1] ?? '') })
      return repairText(leading + translated + trailing)
    }
    return repairText(leading + source + trailing)
  }, [contentLookup, patterns])

  const datasetName = useCallback((dataset: DatasetKey) => {
    const sourceName = datasetLabelSources[dataset] ?? datasets[dataset].name
    return repairText(contentLookup.get(sourceName) ?? (englishLocale.content as Record<string, string>)[sourceName] ?? sourceName)
  }, [bundle, contentLookup])

  useEffect(() => {
    if (!localeReady) return
    document.documentElement.lang = localeTags[language]
    document.documentElement.dir = rtlLanguages.has(language) ? 'rtl' : 'ltr'
    document.title = t('documentTitle')
    const description = document.querySelector<HTMLMetaElement>('meta[name="description"]')
    if (description) description.content = t('documentDescription')
    savePreference('listening-planet.language', language)
  }, [language, localeReady, t])

  const value = useMemo(() => ({ language, setLanguage, t, tx, datasetName }), [language, setLanguage, t, tx, datasetName])
  return (
    <I18nContext.Provider value={value}>
      {localeReady ? children : (
        <main className="locale-loading-screen" role="status" aria-busy="true">
          <span className="locale-loading-spinner" aria-hidden="true" />
        </main>
      )}
    </I18nContext.Provider>
  )
}

export function useLanguage() {
  const context = useContext(I18nContext)
  if (!context) throw new Error('useLanguage must be used within LanguageProvider')
  return context
}
