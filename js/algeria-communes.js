/* algeria-communes.js — Complete list of Algerian communes (FR + AR)
 * 58 wilayas, ~1541 communes (post-2019 redistricting per Décret exécutif 21-198).
 * Exposes:
 *   window.algeriaWilayasList   — array of {id, name, name_ar}
 *   window.algeriaCommunes       — { wilaya_id: [name, ...], ... }  (FR names, flat array)
 *   window.algeriaCommunesFR     — { wilaya_id: [name, ...] }         (alias of algeriaCommunes)
 *   window.algeriaCommunesAR     — reserved for future Arabic list
 *   window.algeriaCommunesCount  — { wilaya_id: N, ... }
 *   window.algeriaCommunesTotal  — grand total
 */
(function() {
    'use strict';

    var W = [
        [1,'Adrar','أدرار'],[2,'Chlef','الشلف'],[3,'Laghouat','الأغواط'],
        [4,'Oum El Bouaghi','أم البواقي'],[5,'Batna','باتنة'],[6,'Béjaïa','بجاية'],
        [7,'Biskra','بسكرة'],[8,'Béchar','بشار'],[9,'Blida','البليدة'],
        [10,'Bouira','البويرة'],[11,'Tamanrasset','تمنراست'],[12,'Tébessa','تبسة'],
        [13,'Tlemcen','تلمسان'],[14,'Tiaret','تيارت'],[15,'Tizi Ouzou','تيزي وزو'],
        [16,'Alger','الجزائر'],[17,'Djelfa','الجلفة'],[18,'Jijel','جيجل'],
        [19,'Sétif','سطيف'],[20,'Saïda','سعيدة'],[21,'Skikda','سكيكدة'],
        [22,'Sidi Bel Abbès','سيدي بلعباس'],[23,'Annaba','عنابة'],[24,'Guelma','قالمة'],
        [25,'Constantine','قسنطينة'],[26,'Médéa','المدية'],[27,'Mostaganem','مستغانم'],
        [28,'Msila','المسيلة'],[29,'Mascara','معسكر'],[30,'Ouargla','ورقلة'],
        [31,'Oran','وهران'],[32,'El Bayadh','البيض'],[33,'Illizi','إليزي'],
        [34,'Bordj Bou Arreridj','برج بوعريريج'],[35,'Boumerdès','بومرداس'],
        [36,'El Tarf','الطارف'],[37,'Tindouf','تندوف'],[38,'Tissemsilt','تيسمسيلت'],
        [39,'El Oued','الوادي'],[40,'Khenchela','خنشلة'],[41,'Souk Ahras','سوق أهراس'],
        [42,'Tipaza','تيبازة'],[43,'Mila','ميلة'],[44,'Aïn Defla','عين الدفلى'],
        [45,'Naâma','النعامة'],[46,'Aïn Témouchent','عين تموشنت'],[47,'Ghardaïa','غرداية'],
        [48,'Relizane','غليزان'],[49,'Timimoun','تيميمون'],[50,'Bordj Badji Mokhtar','برج باجي مختار'],
        [51,'Ouled Djellal','أولاد جلال'],[52,'Béni Abbès','بني عباس'],[53,'In Salah','إن صالح'],
        [54,'In Guezzam','إن قزام'],[55,'Touggourt','تقرت'],[56,'Djanet','جانت'],
        [57,'El M\'Ghair','المغير'],[58,'El Meniaa','المنيعة']
    ];

    function _dedup(list) {
        var seen = {};
        var out = [];
        for (var i = 0; i < list.length; i++) {
            var k = (list[i] || '').trim();
            if (!k) continue;
            var kk = k.toLowerCase();
            if (seen[kk]) continue;
            seen[kk] = true;
            out.push(k);
        }
        return out;
    }

    function _build(frById) {
        var COMM = {};
        var COUNTS = {};
        for (var id = 1; id <= 58; id++) {
            var frList = _dedup(frById[id] || []);
            COMM[id] = frList;
            COUNTS[id] = frList.length;
        }
        return { COMM: COMM, COUNTS: COUNTS };
    }

    var FR = {

1:["Adrar", "Akabli", "Aoulef", "Bouda", "Fenoughil", "In Zghmir", "Ouled Ahmed Timmi", "Reggane", "Sali", "Sebaa", "Tamantit", "Tamest", "Timekten", "Tit", "Tsabit", "Zaouiet Kounta"],
2:["Abou El Hassane", "Ain Merane", "Benairia", "Beni  Bouattab", "Beni Haoua", "Beni Rached", "Boukadir", "Bouzeghaia", "Breira", "Chettia", "Chlef", "Dahra", "El Hadjadj", "El Karimia", "El Marsa", "Harchoun", "Herenfa", "Labiod Medjadja", "Moussadek", "Oued Fodda", "Oued Goussine", "Oued Sly", "Ouled Abbes", "Ouled Ben Abdelkader", "Ouled Fares", "Oum Drou", "Sendjas", "Sidi Abderrahmane", "Sidi Akkacha", "Sobha", "Tadjena", "Talassa", "Taougrit", "Tenes", "Zeboudja"],
3:["Aflou", "Ain Madhi", "Ain Sidi Ali", "Benacer Benchohra", "Brida", "El Assafia", "El Beidha", "El Ghicha", "El Haouaita", "Gueltat Sidi Saad", "Hadj Mechri", "Hassi Delaa", "Hassi R'mel", "Kheneg", "Ksar El Hirane", "Laghouat", "Oued M'zi", "Oued Morra", "Sebgag", "Sidi Bouzid", "Sidi Makhlouf", "Tadjemout", "Tadjrouna", "Taouiala"],
4:["Ain Babouche", "Ain Beida", "Ain Diss", "Ain Fekroun", "Ain Kercha", "Ain M'lila", "Ain Zitoun", "Behir Chergui", "Berriche", "Bir Chouhada", "Dhalaa", "El Amiria", "El Belala", "El Djazia", "El Fedjoudj Boughrara Sa", "El Harmilia", "Fkirina", "Hanchir Toumghani", "Ksar Sbahi", "Meskiana", "Oued Nini", "Ouled Gacem", "Ouled Hamla", "Ouled Zouai", "Oum El Bouaghi", "Rahia", "Sigus", "Souk Naamane", "Zorg"],
5:["Ain Djasser", "Ain Touta", "Ain Yagout", "Arris", "Azil Abedelkader", "Barika", "Batna", "Beni Foudhala El Hakania", "Bitam", "Boulhilat", "Boumagueur", "Boumia", "Bouzina", "Chemora", "Chir", "Djerma", "Djezzar", "El Hassi", "El Madher", "Fesdis", "Foum Toub", "Ghassira", "Gosbat", "Guigba", "Hidoussa", "Ichemoul", "Inoughissen", "Kimmel", "Ksar Bellezma", "Larbaa", "Lazrou", "Lemcene", "M Doukal", "Maafa", "Menaa", "Merouana", "N Gaous", "Oued Chaaba", "Oued El Ma", "Oued Taga", "Ouled Ammar", "Ouled Aouf", "Ouled Fadel", "Ouled Sellem", "Ouled Si Slimane", "Ouyoun El Assafir", "Rahbat", "Ras El Aioun", "Sefiane", "Seggana", "Seriana", "T Kout", "Talkhamt", "Taxlent", "Tazoult", "Teniet El Abed", "Tighanimine", "Tigharghar", "Tilatou", "Timgad", "Zanet El Beida"],
6:["Adekar", "Ait R'zine", "Ait-Smail", "Akbou", "Akfadou", "Amalou", "Amizour", "Aokas", "Barbacha", "Bejaia", "Beni Djellil", "Beni K'sila", "Beni-Mallikeche", "Benimaouche", "Boudjellil", "Bouhamza", "Boukhelifa", "Chellata", "Chemini", "Darguina", "Dra El Caid", "El Kseur", "Fenaia Il Maten", "Feraoun", "Ighil-Ali", "Ighram", "Kendira", "Kherrata", "Leflaye", "M'cisna", "Melbou", "Oued Ghir", "Ouzellaguen", "Seddouk", "Sidi Ayad", "Sidi-Aich", "Smaoun", "Souk El Tenine", "Souk Oufella", "Tala Hamza", "Tamokra", "Tamridjet", "Taourit Ighil", "Taskriout", "Tazmalt", "Tibane", "Tichy", "Tifra", "Timezrit", "Tinebdar", "Tizi-N'berber", "Toudja"],
7:["Ain Naga", "Ain Zaatout", "Biskra", "Bordj Ben Azzouz", "Bouchakroun", "Branis", "Chetma", "Djemorah", "El Feidh", "El Ghrous", "El Hadjab", "El Haouch", "El Kantara", "El Outaya", "Foughala", "Khenguet Sidi Nadji", "Lichana", "Lioua", "M'chouneche", "M'lili", "Mekhadma", "Meziraa", "Oumache", "Ourlal", "Sidi Okba", "Tolga", "Zeribet El Oued"],
8:["Abadla", "Bechar", "Beni-Ounif", "Boukais", "Erg-Ferradj", "Kenadsa", "Lahmar", "Machraa-Houari-Boumediene", "Meridja", "Mogheul", "Tabelbala", "Taghit"],
9:["Ain Romana", "Beni Mered", "Beni-Tamou", "Benkhelil", "Blida", "Bouarfa", "Boufarik", "Bougara", "Bouinan", "Chebli", "Chiffa", "Chrea", "Djebabra", "El-Affroun", "Guerrouaou", "Hammam Elouane", "Larbaa", "Meftah", "Mouzaia", "Oued  Djer", "Oued El Alleug", "Ouled Slama", "Ouled Yaich", "Souhane", "Soumaa"],
10:["Aghbalou", "Ahl El Ksar", "Ain El Hadjar", "Ain Laloui", "Ain Turk", "Ain-Bessem", "Ait Laaziz", "Aomar", "Ath Mansour", "Bechloul", "Bir Ghbalou", "Bordj Okhriss", "Bouderbala", "Bouira", "Boukram", "Chorfa", "Dechmia", "Dirah", "Djebahia", "El Adjiba", "El Asnam", "El Hachimia", "El Khabouzia", "El-Hakimia", "El-Mokrani", "Guerrouma", "Hadjera Zerga", "Haizer", "Hanif", "Kadiria", "Lakhdaria", "M Chedallah", "Maala", "Maamora", "Mezdour", "Oued El Berdi", "Ouled Rached", "Raouraoua", "Ridane", "Saharidj", "Souk El Khemis", "Sour El Ghozlane", "Taghzout", "Taguedite", "Z'barbar (El Isseri )"],
11:["Abelsa", "Ain Amguel", "Idles", "Tamanrasset", "Tazrouk"],
12:["Ain Zerga", "Bedjene", "Bekkaria", "Bir Dheheb", "Bir Mokkadem", "Bir-El-Ater", "Boukhadra", "Boulhaf Dyr", "Cheria", "El Kouif", "El Malabiod", "El Meridj", "El Mezeraa", "El Ogla", "El Ogla El Malha", "El-Aouinet", "El-Houidjbet", "Ferkane", "Guorriguer", "Hammamet", "Morsott", "Negrine", "Ouenza", "Oum Ali", "Saf Saf El Ouesra", "Stah Guentis", "Tebessa", "Telidjen"],
13:["Ain Fetah", "Ain Fezza", "Ain Ghoraba", "Ain Kebira", "Ain Nehala", "Ain Tellout", "Ain Youcef", "Amieur", "Azail", "Bab El Assa", "Beni Bahdel", "Beni Boussaid", "Beni Khellad", "Beni Mester", "Beni Ouarsous", "Beni Smiel", "Beni Snous", "Bensekrane", "Bouhlou", "Bouihi", "Chetouane", "Dar Yaghmoracen", "Djebala", "El Aricha", "El Fehoul", "El Gor", "Fellaoucene", "Ghazaouet", "Hammam Boughrara", "Hennaya", "Honnaine", "M'sirda Fouaga", "Maghnia", "Mansourah", "Marsa Ben M'hidi", "Nedroma", "Oued Lakhdar", "Ouled Mimoun", "Ouled Riyah", "Remchi", "Sabra", "Sebbaa Chioukh", "Sebdou", "Sidi Abdelli", "Sidi Djillali", "Sidi Medjahed", "Souahlia", "Souani", "Souk Tleta", "Terny Beni Hediel", "Tianet", "Tlemcen", "Zenata"],
14:["Ain Bouchekif", "Ain Deheb", "Ain Dzarit", "Ain El Hadid", "Ain Kermes", "Bougara", "Chehaima", "Dahmouni", "Djebilet Rosfa", "Djillali Ben Amar", "Faidja", "Frenda", "Guertoufa", "Hamadia", "Ksar Chellala", "Madna", "Mahdia", "Mechraa Safa", "Medrissa", "Medroussa", "Meghila", "Mellakou", "Nadorah", "Naima", "Oued Lilli", "Rahouia", "Rechaiga", "Sebaine", "Sebt", "Serghine", "Si Abdelghani", "Sidi Abderrahmane", "Sidi Ali Mellal", "Sidi Bakhti", "Sidi Hosni", "Sougueur", "Tagdempt", "Takhemaret", "Tiaret", "Tidda", "Tousnina", "Zmalet El Emir Abdelkade"],
15:["Abi-Youcef", "Aghribs", "Agouni-Gueghrane", "Ain-El-Hammam", "Ain-Zaouia", "Ait Aggouacha", "Ait Bouaddou", "Ait Boumahdi", "Ait Khellili", "Ait Yahia Moussa", "Ait-Aissa-Mimoun", "Ait-Chafaa", "Ait-Mahmoud", "Ait-Oumalou", "Ait-Toudert", "Ait-Yahia", "Akbil", "Akerrou", "Assi-Youcef", "Azazga", "Azeffoun", "Beni Zmenzer", "Beni-Aissi", "Beni-Douala", "Beni-Yenni", "Beni-Zikki", "Boghni", "Boudjima", "Bounouh", "Bouzeguene", "Draa-Ben-Khedda", "Draa-El-Mizan", "Freha", "Frikat", "Iboudrarene", "Idjeur", "Iferhounene", "Ifigha", "Iflissen", "Illilten", "Illoula Oumalou", "Imsouhal", "Irdjen", "Larbaa Nath Irathen", "M'kira", "Maatkas", "Makouda", "Mechtras", "Mekla", "Mizrana", "Ouacif", "Ouadhias", "Ouaguenoun", "Sidi Namane", "Souama", "Souk-El-Tenine", "Tadmait", "Tigzirt", "Timizart", "Tirmitine", "Tizi N'tleta", "Tizi-Gheniff", "Tizi-Ouzou", "Tizi-Rached", "Yakourene", "Yatafene", "Zekri"],
16:["Ain Benian", "Ain Taya", "Alger Centre", "Bab El Oued", "Bab Ezzouar", "Baba Hassen", "Bachedjerah", "Baraki", "Ben Aknoun", "Beni Messous", "Bir Mourad Rais", "Bir Touta", "Birkhadem", "Bologhine Ibnou Ziri", "Bordj El Bahri", "Bordj El Kiffan", "Bourouba", "Bouzareah", "Casbah", "Cheraga", "Dar El Beida", "Dely Ibrahim", "Djasr Kasentina", "Douira", "Draria", "El Achour", "El Biar", "El Harrach", "El Madania", "El Magharia", "El Marsa", "El Mouradia", "Hammamet", "Herraoua", "Hussein Dey", "Hydra", "Khraissia", "Kouba", "Les Eucalyptus", "Maalma", "Mohamed Belouzdad", "Mohammadia", "Oued Koriche", "Oued Smar", "Ouled Chebel", "Ouled Fayet", "Rahmania", "Rais Hamidou", "Reghaia", "Rouiba", "Sehaoula", "Sidi M'hamed", "Sidi Moussa", "Souidania", "Staoueli", "Tessala El Merdja", "Zeralda"],
17:["Ain Chouhada", "Ain El Ibel", "Ain Fekka", "Ain Maabed", "Ain Oussera", "Amourah", "Benhar", "Benyagoub", "Birine", "Bouira Lahdab", "Charef", "Dar Chioukh", "Deldoul", "Djelfa", "Douis", "El Guedid", "El Idrissia", "El Khemis", "Faidh El Botma", "Guernini", "Guettara", "Had Sahary", "Hassi Bahbah", "Hassi El Euch", "Hassi Fedoul", "M'liliha", "Messaad", "Moudjebara", "Oum Laadham", "Sed Rahal", "Selmana", "Sidi Baizid", "Sidi Laadjel", "Taadmit", "Zaafrane", "Zaccar"],
18:["Bordj T'har", "Boudria Beniyadjis", "Bouraoui Belhadef", "Boussif Ouled Askeur", "Chahna", "Chekfa", "Djemaa Beni Habibi", "Djimla", "El Ancer", "El Aouana", "El Kennar Nouchfi", "El Milia", "Emir Abdelkader", "Erraguene Souissi", "Ghebala", "Jijel", "Kaous", "Khiri Oued Adjoul", "Oudjana", "Ouled Rabah", "Ouled Yahia Khadrouch", "Selma Benziada", "Settara", "Sidi Abdelaziz", "Sidi Marouf", "Taher", "Texenna", "Ziama Mansouriah"],
19:["Ain Abessa", "Ain Arnat", "Ain Azel", "Ain El Kebira", "Ain Lahdjar", "Ain Oulmene", "Ain-Legradj", "Ain-Roua", "Ain-Sebt", "Ait Naoual Mezada", "Ait-Tizi", "Amoucha", "Babor", "Bazer-Sakra", "Beidha Bordj", "Bellaa", "Beni Chebana", "Beni Fouda", "Beni Ourtilane", "Beni Oussine", "Beni-Aziz", "Beni-Mouhli", "Bir Haddada", "Bir-El-Arch", "Bouandas", "Bougaa", "Bousselam", "Boutaleb", "Dehamcha", "Djemila", "Draa-Kebila", "El Eulma", "El Ouricia", "El-Ouldja", "Guellal", "Guelta Zerka", "Guenzet", "Guidjel", "Hamam Soukhna", "Hamma", "Hammam Guergour", "Harbil", "Kasr El Abtal", "Maaouia", "Maouaklane", "Mezloug", "Oued El Bared", "Ouled Addouane", "Ouled Sabor", "Ouled Si Ahmed", "Ouled Tebben", "Rosfa", "Salah Bey", "Serdj-El-Ghoul", "Setif", "Tachouda", "Tala-Ifacene", "Taya", "Tella", "Tizi N'bechar"],
20:["Ain El Hadjar", "Ain Sekhouna", "Ain Soltane", "Doui Thabet", "El Hassasna", "Hounet", "Maamora", "Moulay Larbi", "Ouled Brahim", "Ouled Khaled", "Saida", "Sidi Ahmed", "Sidi Amar", "Sidi Boubekeur", "Tircine", "Youb"],
21:["Ain Bouziane", "Ain Charchar", "Ain Kechra", "Ain Zouit", "Azzaba", "Bekkouche Lakhdar", "Ben Azzouz", "Beni Bechir", "Beni Oulbane", "Beni Zid", "Bin El Ouiden", "Bouchetata", "Cheraia", "Collo", "Djendel Saadi Mohamed", "El Arrouch", "El Ghedir", "El Hadaiek", "El Marsa", "Emjez Edchich", "Es Sebt", "Filfila", "Hammadi Krouma", "Kanoua", "Kerkara", "Khenag Maoune", "Oued Zhour", "Ouldja Boulbalout", "Ouled Attia", "Ouled Habbaba", "Oum Toub", "Ramdane Djamel", "Salah Bouchaour", "Sidi Mezghiche", "Skikda", "Tamalous", "Zerdezas", "Zitouna"],
22:["Ain El Berd", "Ain Kada", "Ain Thrid", "Ain Tindamine", "Ain- Adden", "Amarnas", "Bedrabine El Mokrani", "Belarbi", "Ben Badis", "Benachiba Chelia", "Bir El Hammam", "Boudjebaa El Bordj", "Boukhanefis", "Chetouane Belaila", "Dhaya", "El Hacaiba", "Hassi Dahou", "Hassi Zahana", "Lamtar", "M'cid", "Makedra", "Marhoum", "Merine", "Mezaourou", "Mostefa  Ben Brahim", "Moulay Slissen", "Oued Sebaa", "Oued Sefioun", "Oued Taourira", "Ras El Ma", "Redjem Demouche", "Sehala Thaoura", "Sfisef", "Sidi Ali Benyoub", "Sidi Ali Boussidi", "Sidi Bel-Abbes", "Sidi Brahim", "Sidi Chaib", "Sidi Dahou Zairs", "Sidi Hamadouche", "Sidi Khaled", "Sidi Lahcene", "Sidi Yacoub", "Tabia", "Taoudmout", "Tefessour", "Teghalimet", "Telagh", "Tenira", "Tessala", "Tilmouni", "Zerouala"],
23:["Ain El Berda", "Annaba", "Berrahal", "Chetaibi", "Cheurfa", "El Bouni", "El Eulma", "El Hadjar", "Oued El Aneb", "Seraidi", "Sidi Amar", "Treat"],
24:["Ain Ben Beida", "Ain Larbi", "Ain Makhlouf", "Ain Regada", "Ain Sandel", "Belkheir", "Bendjarah", "Beni Mezline", "Bordj Sabath", "Bou Hachana", "Bou Hamdane", "Bouati Mahmoud", "Bouchegouf", "Boumahra Ahmed", "Dahouara", "Djeballah Khemissi", "El Fedjoudj", "Guelaat Bou Sbaa", "Guelma", "Hammam Debagh", "Hammam N'bail", "Heliopolis", "Houari Boumedienne", "Khezaras", "Medjez Amar", "Medjez Sfa", "Nechmaya", "Oued Cheham", "Oued Ferragha", "Oued Zenati", "Ras El Agba", "Roknia", "Sellaoua Announa", "Tamlouka"],
25:["Ain Abid", "Ain Smara", "Ben Badis", "Beni Hamidane", "Constantine", "Didouche Mourad", "El Khroub", "Hamma Bouziane", "Ibn Ziad", "Messaoud Boudjeriou", "Ouled Rahmoun", "Zighoud Youcef"],
26:["Ain Boucif", "Ain Ouksir", "Aissaouia", "Aziz", "Baata", "Ben Chicao", "Beni Slimane", "Berrouaghia", "Bir Ben Laabed", "Boghar", "Bouaiche", "Bouaichoune", "Bouchrahil", "Boughzoul", "Bouskene", "Chabounia", "Chelalet El Adhaoura", "Cheniguel", "Derrag", "Djouab", "Draa Esmar", "El Azizia", "El Guelbelkebir", "El Hamdania", "El Haoudane", "El Omaria", "El Ouinet", "Hannacha", "Kef Lakhdar", "Khams Djouamaa", "Ksar El Boukhari", "M'fatha", "Maghraoua", "Medea", "Medjebar", "Mezerana", "Mihoub", "Ouamri", "Oued Harbil", "Ouled Antar", "Ouled Bouachra", "Ouled Brahim", "Ouled Deid", "Ouled Emaaraf", "Ouled Hellal", "Oum El Djellil", "Ouzera", "Rebaia", "Saneg", "Sedraya", "Seghouane", "Si Mahdjoub", "Sidi Demed", "Sidi Naamane", "Sidi Rabie", "Sidi Zahar", "Sidi Ziane", "Souagui", "Tablat", "Tafraout", "Tamesguida", "Tizi Mahdi", "Tletat Ed Douair", "Zoubiria"],
27:["Achaacha", "Ain-Boudinar", "Ain-Nouissy", "Ain-Sidi Cherif", "Ain-Tedles", "Benabdelmalek Ramdane", "Bouguirat", "Fornaka", "Hadjadj", "Hassi Mameche", "Hassiane", "Khadra", "Kheir-Eddine", "Mansourah", "Mazagran", "Mesra", "Mostaganem", "Nekmaria", "Oued El Kheir", "Ouled Boughalem", "Ouled-Maalah", "Safsaf", "Sayada", "Sidi Ali", "Sidi Belaattar", "Sidi-Lakhdar", "Sirat", "Souaflia", "Sour", "Stidia", "Tazgait", "Touahria"],
28:["Ain El Hadjel", "Ain El Melh", "Ain Fares", "Ain Khadra", "Ain Rich", "Belaiba", "Ben Srour", "Beni Ilmane", "Benzouh", "Berhoum", "Bir Foda", "Bou Saada", "Bouti Sayeh", "Chellal", "Dehahna", "Djebel Messaad", "El Hamel", "El Houamed", "Hammam Dalaa", "Khettouti Sed-El-Jir", "Khoubana", "M'cif", "M'sila", "M'tarfa", "Maadid", "Maarif", "Magra", "Medjedel", "Menaa", "Mohamed Boudiaf", "Ouanougha", "Ouled Addi Guebala", "Ouled Derradj", "Ouled Madhi", "Ouled Mansour", "Ouled Sidi Brahim", "Ouled Slimane", "Oulteme", "Sidi Aissa", "Sidi Ameur", "Sidi Hadjeres", "Sidi M'hamed", "Slim", "Souamaa", "Tamsa", "Tarmount", "Zarzour"],
29:["Ain Fares", "Ain Fekan", "Ain Ferah", "Ain Frass", "Alaimia", "Aouf", "Benian", "Bou Henni", "Bouhanifia", "Chorfa", "El Bordj", "El Gaada", "El Ghomri", "El Gueitena", "El Hachem", "El Keurt", "El Mamounia", "El Menaouer", "Ferraguig", "Froha", "Gharrous", "Ghriss", "Guerdjoum", "Hacine", "Khalouia", "Makhda", "Maoussa", "Mascara", "Matemore", "Mocta-Douz", "Mohammadia", "Nesmot", "Oggaz", "Oued El Abtal", "Oued Taria", "Ras El Ain Amirouche", "Sedjerara", "Sehailia", "Sidi Abdeldjebar", "Sidi Abdelmoumene", "Sidi Boussaid", "Sidi Kada", "Sig", "Tighennif", "Tizi", "Zahana", "Zelamta"],
30:["Ain Beida", "El Borma", "Hassi Ben Abdellah", "Hassi Messaoud", "N'goussa", "Ouargla", "Rouissat", "Sidi Khouiled"],
31:["Ain Biya", "Ain Kerma", "Ain Turk", "Arzew", "Ben Freha", "Bethioua", "Bir El Djir", "Boufatis", "Bousfer", "Boutlelis", "El Ancor", "El Braya", "El Kerma", "Es Senia", "Gdyel", "Hassi Ben Okba", "Hassi Bounif", "Hassi Mefsoukh", "Marsat El Hadjadj", "Mers El Kebir", "Messerghin", "Oran", "Oued Tlelat", "Sidi Ben Yebka", "Sidi Chami", "Tafraoui"],
32:["Ain El Orak", "Arbaouat", "Boualem", "Bougtoub", "Boussemghoun", "Brezina", "Cheguig", "Chellala", "El Bayadh", "El Bnoud", "El Kheiter", "El Mehara", "Ghassoul", "Kef El Ahmar", "Krakda", "Labiodh Sidi Cheikh", "Rogassa", "Sidi Ameur", "Sidi Slimane", "Sidi Tiffour", "Stitten", "Tousmouline"],
33:["Bordj Omar Driss", "Debdeb", "Illizi", "In Amenas"],
34:["Ain Taghrout", "Ain Tesra", "B. B. Arreridj", "Belimour", "Ben Daoud", "Bir Kasdali", "Bordj Ghedir", "Bordj Zemmoura", "Colla", "Djaafra", "El Achir", "El Annasseur", "El Euch", "El M'hir", "El Main", "Elhammadia", "Ghailasa", "Haraza", "Hasnaoua", "Khelil", "Ksour", "Mansoura", "Medjana", "Ouled Brahem", "Ouled Dahmane", "Ouled Sidi-Brahim", "Rabta", "Ras El Oued", "Sidi-Embarek", "Taglait", "Tassamert", "Tefreg", "Teniet En Nasr", "Tixter"],
35:["Afir", "Ammal", "Baghlia", "Ben Choud", "Beni Amrane", "Bordj Menaiel", "Boudouaou", "Boudouaou El Bahri", "Boumerdes", "Bouzegza Keddara", "Chabet El Ameur", "Corso", "Dellys", "Djinet", "El Kharrouba", "Hammedi", "Isser", "Khemis El Khechna", "Larbatache", "Leghata", "Naciria", "Ouled Aissa", "Ouled Hedadj", "Ouled Moussa", "Si Mustapha", "Sidi Daoud", "Souk El Had", "Taourga", "Thenia", "Tidjelabine", "Timezrit", "Zemmouri"],
36:["Ain El Assel", "Ain Kerma", "Asfour", "Ben M Hidi", "Berrihane", "Besbes", "Bougous", "Bouhadjar", "Bouteldja", "Chebaita Mokhtar", "Chefia", "Chihani", "Drean", "Echatt", "El Aioun", "El Kala", "El Tarf", "Hammam Beni Salah", "Lac Des Oiseaux", "Oued Zitoun", "Raml Souk", "Souarekh", "Zerizer", "Zitouna"],
37:["Oum El Assel", "Tindouf"],
38:["Ammari", "Beni Chaib", "Beni Lahcene", "Bordj Bounaama", "Bordj El Emir Abdelkader", "Boucaid", "Khemisti", "Larbaa", "Lardjem", "Layoune", "Lazharia", "Maacem", "Melaab", "Ouled Bessam", "Sidi Abed", "Sidi Boutouchent", "Sidi Lantri", "Sidi Slimane", "Tamellahet", "Theniet El Had", "Tissemsilt", "Youssoufia"],
39:["Bayadha", "Ben Guecha", "Debila", "Douar El Maa", "El Ogla", "El-Oued", "Guemar", "Hamraia", "Hassani Abdelkrim", "Hassi Khalifa", "Kouinine", "Magrane", "Mih Ouansa", "Nakhla", "Oued El Alenda", "Ourmes", "Reguiba", "Robbah", "Sidi Aoun", "Taghzout", "Taleb Larbi", "Trifaoui"],
40:["Ain Touila", "Babar", "Baghai", "Bouhmama", "Chechar", "Chelia", "Djellal", "El Hamma", "El Mahmal", "El Oueldja", "Ensigha", "Kais", "Khenchela", "Khirane", "M'sara", "M'toussa", "Ouled Rechache", "Remila", "Tamza", "Taouzianat", "Yabous"],
41:["Ain Soltane", "Ain Zana", "Bir Bouhouche", "Drea", "Haddada", "Hanencha", "Khedara", "Khemissa", "M'daourouche", "Machroha", "Merahna", "Oued Kebrit", "Ouillen", "Ouled Driss", "Ouled Moumen", "Oum El Adhaim", "Ragouba", "Safel El Ouiden", "Sedrata", "Sidi Fredj", "Souk Ahras", "Taoura", "Terraguelt", "Tiffech", "Zaarouria", "Zouabi"],
42:["Aghbal", "Ahmer El Ain", "Ain Tagourait", "Attatba", "Beni Mileuk", "Bou Haroun", "Bou Ismail", "Bourkika", "Chaiba", "Cherchell", "Damous", "Douaouda", "Fouka", "Gouraya", "Hadjout", "Hadjret Ennous", "Khemisti", "Kolea", "Larhat", "Menaceur", "Merad", "Messelmoun", "Nador", "Sidi Ghiles", "Sidi Rached", "Sidi Semiane", "Sidi-Amar", "Tipaza"],
43:["Ahmed Rachedi", "Ain Beida Harriche", "Ain Mellouk", "Ain Tine", "Amira Arres", "Benyahia Abderrahmane", "Bouhatem", "Chelghoum Laid", "Chigara", "Derrahi Bousselah", "El Ayadi Barbes", "El Mechira", "Ferdjioua", "Grarem Gouga", "Hamala", "Mila", "Minar Zarza", "Oued Athmenia", "Oued Endja", "Oued Seguen", "Ouled Khalouf", "Rouached", "Sidi Khelifa", "Sidi Merouane", "Tadjenanet", "Tassadane Haddada", "Tassala Lematai", "Teleghma", "Terrai Bainen", "Tiberguent", "Yahia Beniguecha", "Zeghaia"],
44:["Ain-Benian", "Ain-Bouyahia", "Ain-Defla", "Ain-Lechiakh", "Ain-Soltane", "Ain-Torki", "Arib", "Bathia", "Belaas", "Ben Allal", "Bir-Ould-Khelifa", "Birbouche", "Bordj-Emir-Khaled", "Boumedfaa", "Bourached", "Djelida", "Djemaa Ouled Cheikh", "Djendel", "El-Abadia", "El-Amra", "El-Attaf", "El-Maine", "Hammam-Righa", "Hassania", "Hoceinia", "Khemis-Miliana", "Mekhatria", "Miliana", "Oued Chorfa", "Oued Djemaa", "Rouina", "Sidi-Lakhdar", "Tacheta Zegagha", "Tarik-Ibn-Ziad", "Tiberkanine", "Zeddine"],
45:["Ain Ben Khelil", "Ain Sefra", "Asla", "Djenienne Bourezg", "El Biodh", "Kasdir", "Makmen Ben Amar", "Mecheria", "Moghrar", "Naama", "Sfissifa", "Tiout"],
46:["Aghlal", "Ain El Arbaa", "Ain Kihal", "Ain Temouchent", "Ain Tolba", "Aoubellil", "Beni Saf", "Bouzedjar", "Chaabat El Ham", "Chentouf", "El Amria", "El Maleh", "El Messaid", "Emir Abdelkader", "Hammam Bou Hadjar", "Hassasna", "Hassi El Ghella", "Oued Berkeche", "Oued Sebbah", "Ouled Boudjemaa", "Ouled Kihal", "Oulhaca El Gheraba", "Sidi Ben Adda", "Sidi Boumediene", "Sidi Ouriache", "Sidi Safi", "Tamzoura", "Terga"],
47:["Berriane", "Bounoura", "Dhayet Bendhahoua", "El Atteuf", "El Guerrara", "Ghardaia", "Mansoura", "Metlili", "Sebseb", "Zelfana"],
48:["Ain Rahma", "Ain-Tarek", "Ammi Moussa", "Belaassel Bouzagza", "Bendaoud", "Beni Dergoun", "Beni Zentis", "Dar Ben Abdelah", "Djidiouia", "El H'madna", "El Hassi", "El Ouldja", "El-Guettar", "El-Matmar", "Had Echkalla", "Hamri", "Kalaa", "Lahlef", "Mazouna", "Mediouna", "Mendes", "Merdja Sidi Abed", "Ouarizane", "Oued El Djemaa", "Oued Essalem", "Oued-Rhiou", "Ouled Aiche", "Ouled Sidi Mihoub", "Ramka", "Relizane", "Sidi Khettab", "Sidi Lazreg", "Sidi M'hamed Benali", "Sidi M'hamed Benaouda", "Sidi Saada", "Souk El Had", "Yellel", "Zemmoura"],
49:["Aougrout", "Charouine", "Deldoul", "Ksar Kaddour", "Metarfa", "Ouled Aissa", "Ouled Said", "Talmine", "Timimoun", "Tinerkouk"],
50:["Bordj Badji Mokhtar", "Timiaouine"],
51:["Besbes", "Chaiba", "Doucen", "Ouled Djellal", "Ras El Miad", "Sidi Khaled"],
52:["Beni-Abbes", "Beni-Ikhlef", "El Ouata", "Igli", "Kerzaz", "Ksabi", "Ouled-Khodeir", "Tamtert", "Timoudi"],
53:["Ain Salah", "Foggaret Ezzoua", "Inghar"],
54:["Ain Guezzam", "Tin Zouatine"],
55:["Benaceur", "Blidet Amor", "El Alia", "El-Hadjira", "M'naguer", "Megarine", "Nezla", "Sidi Slimane", "Taibet", "Tebesbest", "Temacine", "Touggourt", "Zaouia El Abidia"],
56:["Bordj El Haouass", "Djanet"],
57:["Djamaa", "El-M'ghaier", "M'rara", "Oum Touyour", "Sidi Amrane", "Sidi Khelil", "Still", "Tenedla"],
58:["El Meniaa", "Hassi Fehal", "Hassi Gara"]

    };

    var built = _build(FR);
    var COMM = built.COMM;
    var COUNTS = built.COUNTS;

    var TOTAL = 0;
    for (var k in COUNTS) TOTAL += COUNTS[k];

    var WILAYA = W.map(function(r) {
        return { id: r[0], name: r[1], name_ar: r[2] };
    });

    window.algeriaWilayasList = WILAYA;
    window.algeriaCommunes = COMM;
    window.algeriaCommunesFR = {};
    window.algeriaCommunesAR = {};
    for (var id in COMM) {
        window.algeriaCommunesFR[id] = COMM[id].slice();
    }
    window.algeriaCommunesCount = COUNTS;
    window.algeriaCommunesTotal = TOTAL;
})();
