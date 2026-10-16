/**
 * Cities of Pakistan by province/territory: the provincial capitals, divisional
 * and district headquarters, and other towns with a meaningful number of ISPs.
 * Every city starts switched OFF; only cities the user enables are scraped.
 * To add a city, add its name here; its id is derived from province + name, so
 * existing settings are kept.
 */
const BY_PROVINCE = {
  "Islamabad Capital Territory": ["Islamabad"],
  Punjab: [
    "Lahore", "Faisalabad", "Rawalpindi", "Gujranwala", "Multan", "Bahawalpur", "Sargodha", "Sialkot",
    "Sheikhupura", "Rahim Yar Khan", "Jhang", "Dera Ghazi Khan", "Gujrat", "Sahiwal", "Wah Cantonment",
    "Kasur", "Okara", "Chiniot", "Kamoke", "Hafizabad", "Sadiqabad", "Burewala", "Khanewal", "Muzaffargarh",
    "Mandi Bahauddin", "Jhelum", "Khanpur", "Pakpattan", "Daska", "Gojra", "Muridke", "Bahawalnagar",
    "Samundri", "Jaranwala", "Chishtian", "Attock", "Vehari", "Chakwal", "Kamalia", "Ahmedpur East",
    "Wazirabad", "Mianwali", "Layyah", "Narowal", "Taxila", "Khushab", "Bhakkar", "Lodhran", "Toba Tek Singh",
    "Rajanpur", "Nankana Sahib", "Hasilpur", "Arifwala", "Haroonabad", "Murree", "Pattoki", "Kharian",
    "Talagang", "Pindi Bhattian", "Shakargarh", "Chichawatni", "Mian Channu", "Kot Addu", "Jampur", "Bhalwal",
    "Sambrial", "Kot Radha Kishan", "Fort Abbas", "Depalpur", "Renala Khurd",
  ],
  Sindh: [
    "Karachi", "Hyderabad", "Sukkur", "Larkana", "Nawabshah", "Mirpur Khas", "Jacobabad", "Shikarpur",
    "Khairpur", "Dadu", "Tando Allahyar", "Tando Adam", "Thatta", "Badin", "Kotri", "Umerkot", "Sanghar",
    "Ghotki", "Kandhkot", "Kashmore", "Matiari", "Jamshoro", "Naushahro Feroze", "Mithi", "Hala", "Moro",
    "Tando Muhammad Khan", "Sujawal", "Mehar", "Shahdadpur", "Daharki", "Rohri", "Kandiaro",
  ],
  "Khyber Pakhtunkhwa": [
    "Peshawar", "Mardan", "Mingora", "Kohat", "Abbottabad", "Dera Ismail Khan", "Bannu", "Swabi", "Nowshera",
    "Charsadda", "Mansehra", "Haripur", "Chitral", "Timergara", "Batkhela", "Karak", "Lakki Marwat", "Hangu",
    "Tank", "Shabqadar", "Takht-i-Bahi", "Parachinar", "Battagram", "Daggar", "Dir", "Landi Kotal",
    "Jamrud", "Khar", "Miranshah", "Wana", "Topi", "Havelian",
  ],
  Balochistan: [
    "Quetta", "Turbat", "Khuzdar", "Hub", "Chaman", "Gwadar", "Sibi", "Zhob", "Loralai", "Dera Murad Jamali",
    "Dera Allah Yar", "Kalat", "Mastung", "Nushki", "Kharan", "Pishin", "Panjgur", "Usta Muhammad", "Uthal",
    "Ormara", "Pasni", "Qila Saifullah", "Ziarat", "Dalbandin",
  ],
  "Gilgit-Baltistan": ["Gilgit", "Skardu", "Chilas", "Aliabad", "Khaplu", "Gahkuch", "Astore", "Shigar"],
  "Azad Jammu and Kashmir": [
    "Muzaffarabad", "Mirpur", "Kotli", "Bhimber", "Rawalakot", "Bagh", "Pallandri", "Hattian Bala", "Athmuqam",
    "Forward Kahuta",
  ],
};

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

export const PROVINCES = Object.keys(BY_PROVINCE);

export const CITIES = PROVINCES.flatMap((province) =>
  BY_PROVINCE[province].map((name) => ({ id: `${slug(province)}--${slug(name)}`, name, province })),
);
