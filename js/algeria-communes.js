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

1:["Adrar","Reggane","Timoktene","Tsabit","Zaouiet Kounta","Fenoughil","In Zghmir","Ouled Ahmed Tammi","Sali","Tamekten","Tamest","Tamantit","Tinerkouk","Ksar Kaddour","Bouda","Ouled Aissa","Aoulef","Timiaouine","Tit","Zaouia El Abidia","Sebaa","Ouled Ouda","Akabli","Ouled Said","Aougrout","Deldoul","Metarfa","Bordj Badji Mokhtar","Sbaa","Tsalik"],
2:["Chlef","Tenes","Ain Merane","Ouled Fares","Boukadir","Chettia","Sobha","Beni Rached","Bouzeghaia","El Karimia","Beni Haoua","Oued Goussine","Ain Bouzid","Benairia","Ain Defla","Tadjena","Talassa","Sidi Abderrahmane","Herenfa","Tacheta Zougagha","Ouled Ben Abdelkader","Oum Drou","Boucheral","Sendjas","Ain Delba","Moussadek","Arch Bettiou","El Hassania","Ain Titchera","Ouled Bouali","Oued Fodda","El Marsa","Dahra","Medjadja","Zeboudja","Beni Bouateb","Chlef EC","Ain Beida","Oued Sly","Ain Soltane","Sidi Akkacha","Moussadek","Ain Merane"],
3:["Laghouat","Aflou","Ksar El Boukhari","Brida","Sidi Makhlouf","Ain Madhi","Hassi Delaa","Hassi R'Mel","Tadjmout","Gueltat Sidi Saad","Ain Sidi Ali","Beidha","Bennasser Benchohra","El Ghicha","El Haouaita","Ain Tarek","Oued M'Zi","Mokrane","Sidi Bouzid","El Assafia","Sebgag","Taouila","Tadjrouna","Ain Chouhada","Ain Kermes","Bordj","El Beidha","Oued Morra","Hassi Mouna","Sidi Slimane","Ain Tine","Ain El Ibel","Ain El Assel"],
4:["Oum El Bouaghi","Ain Beida","Ain M'lila","Ksar Sbahi","Fkirina","Ouled Hamla","Ain Babouche","Berriche","Zorg","Ain Zitoun","Bir Chouhada","Ouled Gacem","Meskiana","Ain Diss","Behir Chergui","Bouchochana","El Amiria","El Belala","El Djazia","El Fedjoudj Boughrara","El Harmilia","Hanchir Toumghani","Ouled Bouzid","Ouled Ziad","Rahia","Sigus","Souk Naamane","Ain Fekroune","Ain Kercha","Draa Lemti","Boughoufala","Ain Tine","Lafedj"],
5:["Batna","N'Gaous","Merouana","Barika","Arris","Tazoult","Ain Touta","Bouzina","Ain Djasser","El Madher","Seriana","Ain Yagout","Fesdis","Ouled Si Slimane","Chemora","Ouled Aouf","Timgad","Ras El Aioun","Inoughissen","Ouled Fadel","Sefiane","Ain Kechra","Djerma","Beni Foudhala El Hakania","Ain Sidi Ali","Hidoussa","Tixter","Ksar Belezma","Boumaguer","M'Chedallah","Talkhamt","Ouled Ammar","Gosbat","Ouled Sidi Aich","Boulhilat","T'Koutt","Theniet El Abid","Chir","Ain El Assel","Ain El Ksar","Ouled Chebel","Ouled Bouzid","Bitam","Ben Amrane","Ouled Sellam","Ain Tine","Boumia","Lazrou","M'Cif","Lemsane","Ain Ouled Chrif","El Hassi","Ain El Ahdjar"],
6:["Béjaïa","Akbou","Amizour","Kherrata","Sidi Aich","Adekar","Tichy","Oued Ghir","Seddouk","Tazmalt","Souk El Tenine","Chemini","Barbacha","Beni Djellil","Tala Hamza","Ait Smail","Ait Mellal","Darguina","Semaoun","Tamokra","Timezrit","Aokas","Beni Ksila","Toudja","Tibane","Beni Maouch","Beni Ourtilane","Fenaia Ilmaten","Bouhamza","M'Sila","Tifra","Sidi Ayad","El Kseur","Ait R'Zine","Ighil Ali","Beni Embarek","Ait Bouyoucef","Ain El Hammam","Leflaye","Taskriout","Ouzellaguen","Ait Mahamed","Ait Boumahdi","Tamridjt","Boukhelifa","Ait M'Lana","Tala N'Yacoub","Aghboub","Ait Khelili","Ain Chikh","Beni Mellikeche","Djebla","Ait Bouzid","Ouled Aissa","Sidi M'Barek"],
7:["Biskra","El Kantara","Tolga","Ourlal","Sidi Okba","Foughala","El Outaya","M'Chounèche","Sidi Khaled","Chetma","M'Lili","Lichana","Sidi Gheis","Ouled Djellal","Doucen","Chaiba","Ouled Sassi","Ain Naga","Mekhadma","Bouchagroun","Zeribet El Oued","Khenguet Sidi Nadji","El Feidh","El Ghrous","Hassi Bahbah","Oumache","Bordj Ben Azzouz","Branis","Ain Zaatout","Ain Fares","Ain Ferah","Ain Ben Naoui","Ain Zana","Ain El Ksar"],
8:["Béchar","Kenadsa","Taghit","Beni Ounif","Abadla","Beni Ikhlef","Mechraa Houari Boumediene","Lahmar","Boukaïs","El Beïda","Béni Abbès","Tamtert","Kerzaz","El Ouata","Tabelbala","Bechar Djedid","Ouled Khodeïr","Igli","Erg Ferradj"],
9:["Blida","Boufarik","El Affroun","Mouzaia","Meftah","Oued Alleug","Chebli","Bouinan","Ouled Yaïch","Beni Tamou","Bougara","Larbaa","Souhane","Messelmoun","Smailia","Djebabra","Ain Taya","Beni Misra","Chréa","Beni Mellal","Ain El Romana","Ouled Slama","Ben Khlil","Soumaa","Rahmania","Guerrouaou","Oued Djer","Ain El Hadjar","Beni Tamou"],
10:["Bouira","Lakhdaria","M'Chedallah","Sour El Ghozlane","Kadiria","Bechloul","Ain Bessam","El Adjiba","Ain El Turc","El Khabouzia","Ain Laloui","Ain El Hadjar","Bouderbala","Haizer","Ain El Ksar","Djebahia","Ain Tine","Ouled Rached","Ain Bouyoucef","Ait Laaziz","Taghzout","Bordj Okhriss","Mezdour","Saharidj","Ath Mansour","Bordj"],
11:["Tamanrasset","Abalessa","In Amguel","Tazrouk","In Salah","Foggaret Ezzoua","Idles","Tin Zouatine","In Guezzam","Tessalit"],
12:["Tébessa","Cheria","El Aouinet","El Haria","Ouenza","Bir Mokkadem","El Meridj","Bekkaria","Boulhaf","Morsott","M'Doukel","Ain Zerga","El Kouif","Bir El Ater","Negrine","El Ogla","Tlidjene","Hammamet","Bedjene","El Ma Labiodh","Ain Foucha","Ferkane","El Mezeraa","Ain El Beida","Saf Saf El Ouesra","Boukhadra","Oum Ali","Ain Moulahoum","Stah Guentis","Telidjene"],
13:["Tlemcen","Maghnia","Ghazaouet","Remchi","Sebdou","Mansourah","Chetouane","Nedroma","Ain Tellout","Hennaya","Zenata","Beni Snous","Amieur","Ain Fezza","Ouled Mimoun","Bensekrane","Ain Kihal","Sidi Abdelli","Sidi Djillali","El Aricha","Souahlia","Terny Beni Hdiel","Babor","Beni Bahdel","El Fehoul","Azails","Sebaa Chioukh","Tafna","Sidi Medjahed","Ain El Hout","Beni Mester","Fellaoucene","Bouihi","Oued Lakhdar","Ain Ghoraba","Sidi Boumediene","Ain Youcef"],
14:["Tiaret","Sougueur","Frenda","Mahdia","Dahmouni","Oued Lili","Meghila","Ain Deheb","Ain Kermes","Nadorah","Hamadia","Bouchekif","Tagdempt","Medroussa","Mellakou","Ain El Hadid","Ain Dzarit","Sebt","Djillali Ben Amar","Sidi Ali Mellal","Madna","Sidi Bakhti","Ain El Bouck","Faidja","Naima","Medrissa","Serghine","Tousnina","Chehaima","Ksar Chellala","Bordj Bou Naama","Ain El Khadra","Takhemaret","Tidda","Sidi Hosni"],
15:["Tizi Ouzou","Azazga","Boghni","Larbaa Nath Irathen","Draa El Mizan","Beni Yenni","M'kira","Azeffoun","Tigzirt","Ain El Hammam","Ouaguenoun","Ait Boumahdi","Beni Douala","Timizart","Maatkas","Souk El Thenine","Irdjen","Draa Ben Khedda","Tizi Rached","Bouzeguene","Ain Zaouia","Ait Aggouacha","Ait Bouzid","Ait Chafaa","Ait Khelili","Ait Mahmoud","Ait Oumalou","Ait Toudert","Ait Yahia","Ait Zmenzer","Ait Aggouacha","Beni Ziki","Bounouh","Djebel","Djemaa Saharidj","Freha","Frikat","Iboudraren","Idjeur","Iferhounene","Ifigha","Iflissen","Illilten","Imsouhal","Mekla","Mizrana","Ouacif","Ouadhia","Sidi Naamane","Smaila","Tadmaït","Tirmitine","Tizi Gheni","Tizi N'Tleta","Yakourene","Zekri"],
16:["Alger Centre","Sidi M'Hamed","Bab El Oued","Bologhine","Casbah","Oued Koriche","Bir Mourad Rais","El Biar","Bouzareah","Ben Aknoun","Dely Ibrahim","El Harrach","Baraki","Oued Smar","Birkhadem","Saoula","Draria","Cheraga","Baba Hassen","Rahmania","Beni Messous","Ouled Fayet","Staoueli","Zeralda","Mahelma","Souidania","Bordj El Kiffan","El Marsa","Ain Benian","Bordj El Bahri","Houara","Reghaia","Boumerdès","Rouiba","Khemis El Khechna","Bouinan","Birtouta","Les Eucalyptus","Sidi Abdellah","Tessala El Merdja","Douera","Baba Ali","Khraissia","Hydra","Bachdjerrah","Djasr Kasentina","Bourouba","El Annassers","Belouizdad","Hussein Dey","Kouba","Mohammadia","Ain Naadja","Belfort","Hamma","Rais Hamidou"],
17:["Djelfa","Ain Oussera","Messaad","El Idrissia","Hassi Bahbah","Ain El Ibel","Birine","Charef","Dar Chioukh","El Guedid","Faidh El Botma","Had Sahary","M'Liliha","Moudjebara","Oum Laadham","Sidi Baizid","Sidi Ladjel","Taadmit","Zaccar","Ain Chouhada","Ain Fekka","Ain Maabed","Ain Sebaâ","Amourah","Beni Yacoub","Bordj","Bouira Lahdab","El Khemis","Guernini","Haniet Ouled Salem","Mokrane","Ouled Aiche","Ouled M'Barek","Sed Rahal","Selmana","Sidi Mabrouk","Sidi Yahia","Tafreg","Tletat","Zaafrane"],
18:["Jijel","El Milia","Taher","Chekfa","Sidi Abdelaziz","Emir Abdelkader","Ziama Mansouriah","Texenna","Djimla","Sidi Maarouf","Bordj Taher","Chahna","Ain El Ksar","Kaous","Bouhamdane","El Ancer","El Aouana","Ouled Yahia","Selma Benziada","Khiri Oued Adjoul","El Kennar","Boudriaa Ben Yadjis","Ouled Rabah","Ain Fares"],
19:["Sétif","El Eulma","Ain Oulmene","Bougaa","Salah Bey","Ain Azel","Guidjel","Ain Abessa","Ain Arnat","Ain El Kebira","Beni Ourtilane","Beni Fouda","Boumalek","Djémila","Hammam Guergour","Hammam Soukhna","Maaouia","Maoklane","Ouled Sabor","Ouled Si Ahmed","Ouled Tebben","Rasfa","Serdj El Ghoul","Tachouda","Talaifacene","Taya","Tella","Tizi N'Bechar","Ain Legraj"],
20:["Saïda","Ouled Brahim","Youb","Ain El Hadjar","Sidi Boubekeur","Moulay Larbi","Ain Tine","Ain El Ksar","Sidi Amar","Ain Soltane","Ain Zana","Ain Assel"],
21:["Skikda","El Harrouch","Azzaba","Tamalous","Collo","Beni Zid","Ain Bouziane","Sidi Mezghiche","Ain Kechra","Ouled Attia","Ramdane Djamel","Beni Oulbane","Kerkera","Zitouna","Ain Charaia","Ain El Assel","Ain El Ksar","Ain Tine","Ain Zana","Ain Assel"],
22:["Sidi Bel Abbès","Sidi Lahcene","Telagh","Tenira","Merine","Oued Sefioun","Mostefa Ben Brahim","Bir El Hammam","Makedra","Ain Adden","Ain Thrid","Boudjebaa","Chetouane","Dhaya","El Hacaiba","Hassi Dahou","Hassi Zehana","Khalidiya","Lamtar","M'Cid","Mosta Ben Brahim","Oued Taourira","Ras El Ma","Redjem","Sidi Ali Benyoub","Sidi Ali Boussaid","Sidi Brahim","Sidi Chaib","Sidi Damed","Sidi Hamadouche","Sidi Hosni","Sidi Khaled","Sidi Slimane","Sidi Yacoub","Tabia","Taoudmout","Tefessour","Teghalimet","Tilmouni","Zerouala"],
23:["Annaba","El Bouni","El Hadjar","Seraidi","Berrahal","Chetaibi","Ain El Assel","Ain El Ksar","Ain Tine","Ain Zana","Ain Assel"],
24:["Guelma","Oued Zenati","Bouchegouf","Hammam Debagh","Guelaat Bou Sbaa","Heliopolis","Boumahra Ahmed","Ain Makhlouf","Ain Ben Bechir","Medjez Amar","Ain Sandel","Ain Reggada","Khezaras","Hammam N'Bails","Ras El Agba","Sellaoua Announa","Bouati Mahmoud","Tamlouk","Ain Arko","Nechmaya","Oued Fragha","Djeballah Khemissi","Bordj Sabat","Ain Khiar","El Fedjoudj"],
25:["Constantine","El Khroub","Ain Abid","Hamma Bouziane","Zighoud Youcef","Didouche Mourad","Beni Hamiden","Messaoud Boudjriou","Ain Smara","Ibn Ziad","Ouled Rahmoun","Ain El Assel","Ain El Ksar","Ain Tine"],
26:["Médéa","Berrouaghia","Ksar El Boukhari","Tablat","Souaghi","Ouzera","Beni Slimane","Ain Boucif","Ain El Ksar","Ain El Assel","Ain Tine"],
27:["Mostaganem","Ain Tedles","Sidi Ali","Hassi Mameche","Nekmaria","Ouled Malah","Ain Nouissy","Bouguirat","Sirat","Sidi Lakhdar","Mesra","Mansourah","Sour","Tazgait","Khadra","Ain Boudinar","Benabdelmalek Ramdane","Hassiane","Sidi Belkacem","Ain Sidi Cherif","Ouled Boughalem","Souaflia","Touahria","Saf Saf","Stidia","Chaib El Ras","Ouled Abdellah","Ain El Bia","Ain Titchera","Kheir Eddine","Bordj"],
28:["Bordj Bou Arreridj","Ras El Oued","Bordj Ghedir","Ain Taghrout","El Achir","El Main","Bordj Zemoura","Djaafra","Haraza","Khelil","Mansoura","Ouled Brahem","Ouled Si Ahmed","Tixter","Belimour","El Hamra","El M'Cif","Sidi Embarek","Tassamert","Taghramt"],
29:["Mascara","Sig","Mohammedia","Oued El Abtal","Ghriss","Bou Hanifia","Ain Fares","Ain Fekan","Ain Ferah","Ain Frass","Ain Khechna","Ain M'Lila","Ain Nouissy","Ain Soltane","Alaimia","Beniane","Chelif","El Bordj","El Gaada","El Ghomri","El Keurt","El Menaouer","Ferraguig","Froha","Guettena","Hachem","Hacine","Khalouia","Makdha","Matemore","Mocta Douz","Nesmot","Oggaz","Oued Taria","Ras El Aïn","Sebabna","Sedjerara","Sehaîlia","Sidi Abdeldjebar","Sidi Abdelmoumene","Sidi Boussaid","Sidi Kada","Sidi Maarouf","Tighennif","Tizi","Zahana","Zelameta"],
30:["Ouargla","Hassi Messaoud","Rouissat","El Borma","N'Goussa","Hassi Ben Abdellah","Sidi Khouiled","Ain Beida","El Allia","El Hajira","M'Ziraa","Megarine","Sidi Slimane","Tebesbest","Nezla","Zaouia El Abidia"],
31:["Oran","Es Senia","Bir El Djir","Arzew","Boutlelis","Oued Tlélat","Gdyel","Misserghin","Ain Kerma","Ain El Turc","Ain El Bia","Boufatis","Ben Freha","Ain Taya","Hassi Ben Okba","Hassi Mefsoukh","Mers El Kebir","Ain El Kerma","Sidi Chahmi"],
32:["El Bayadh","Brezina","Bougtob","Chellala","El Abiodh Sidi Cheikh","Boualem","El Bnoud","Kef El Ahmar","Rogassa","Sidi Amar","Sidi Slimane","Sidi Tifour","Stitten","Tousmouline"],
33:["Illizi","Djanet","Debdeb","Bordj Omar Driss","Bordj El Haouas","In Amenas"],
34:["Bordj Bou Arreridj","Ras El Oued","Bordj Zemoura","El Ach","Djaafra","Bordj Ghedir","Ain Taghrout","El Main","Haraza","Khelil","Mansoura","Ouled Brahem","Ouled Si Ahmed","Tixter","Belimour","El Hamra","El M'Cif","Sidi Embarek","Tassamert","Taghramt"],
35:["Boumerdès","Boudouaou","Dellys","Thenia","Bordj Menaiel","Khemis El Khechna","Ouled Moussa","Corso","Baghlia","Ben Choud","Beni Amrane","Boudouaou","Bouzegza","Chabet El Ameur","Djinet","El Kharrouba","Hammedi","Isser","Lac des Oiseaux","Larbatache","Leghata","Naciria","Ouled Aissa","Ouled Hedadj","Si Mustapha","Souk El Had","Taourga","Tidjelabine","Timezrit","Zemmouri"],
36:["El Tarf","Besbes","Drean","Ben Mehidi","El Kala","Bouteldja","Bouhadjar","Chebaita Mokhtar","Echatt","El Aioun","Hammam Beni Salah","Oued Zitoun","Raml Souk","Souarekh","Zerizer","Zitouna"],
37:["Tindouf","Oum El Assel"],
38:["Tissemsilt","Bordj Emir Khaled","Lardjem","Theniet El Had","Sidi Slimane","Beni Chaib","Beni Lahcene","Boucaid","Khemisti","Laayoune","Lazib","Maacem","Melaab","Sidi Abed","Sidi Boutouchent","Sidi Lantri","Tizi","Youssoufia"],
39:["El Oued","Guemar","Debila","Robbah","Bayadha","Douar El Ma","El Mghair","Hassi Khalifa","Kouinine","Nakhla","Oued El Alenda","Oum Touyour","Reguiba","Sidi Aoun","Taghzout","Trifaoui"],
40:["Khenchela","Kaïs","Ain Touila","El Hamma","Chechar","Ouled Rechache","Baghai","Bouhmama","Chelia","Djellal","Ensigha","Fais","Khirane","Mahmel","M'Sara","M'Toussa","Ouled Bouzid","Remila","Yabous"],
41:["Souk Ahras","Sedrata","Mechroha","Limouna","Ouled Driss","Tiffech","Bir Bouhouche","Haddada","Hanancha","Khardi","Madaure","Merahna","Oued Keberit","Ouled Moumen","Oum El Adhaim","Ragouba","Safel El Ouiden","Sidi Fredj","Taoura","Terraguelt","Zouabi"],
42:["Tipaza","Cherchell","Hadera","Bou Ismail","Sidi Amar","Gouraya","Nador","Fouka","Kolea","Ahmar El Aïn","Attatba","Beni Mileuk","Bouharoun","Bourkika","Chaiba","Damous","Douaouda","Fouka Marine","Hadjout","Hammam Righa","Larhat","Menaceur","Messelmoun","Sidi Ghiles"],
43:["Mila","Ferdjioua","Chelghoum Laid","Tadjenanet","Grarem Gouga","Telerghma","Ahmed Rachedi","Ain Beida","Ain El Hamra","Ain Mellouk","Ben Yahia","Bouhatem","Chigara","Derradji Bousselah","El Mechira","Elayadi Barbes","Ferroudj","Hamala","Minar Zarza","Oued Athmenia","Oued Endja","Ouled Khalouf","Sidi Khelifa","Sidi Merouane","Terrai Bainen","Yahia Beniguecha","Zeghaia"],
44:["Aïn Defla","Khemis Miliana","El Abadia","Rouina","Miliana","Boumedfaa","Ain Lechiakh","Ain Soltane","Ain Bouyahia","Bathia","Belaas","Ben Allal","Bir Ould Khelifa","Bordj Emir Khaled","Bourached","Djendel","El Amra","El Attaf","El Maine","Hoceinia","Mekhatria","Oued Chorfa","Oued Djemaa","Sidi Lakhdar","Tacheta Zougagha","Tarik Ibn Ziad","Tiberkanine","Zeddine"],
45:["Naâma","Mecheria","Ain Sefra","Moghrar","Asla","Djeniene Bou Rezg","Ain Ben Khelil","El Biodh","El Kasdir","Faidja","Makman Ben Amer","Mekmen Ben Amar","Mougheul","Sfissifa","Tiout"],
46:["Aïn Témouchent","Beni Saf","El Amria","Hammam Bou Hadjar","Oulhaça El Gheraba","Ain El Arbaa","Ain Kihal","Ain Larbaa","Ain Tolba","Bouzedjar","Chentouf","El Messaid","Emir Abdelkader","Hassasna","M'Sila","Oued Berkèche","Oued Sabah","Sidi Ben Adda","Sidi Boumediene","Sidi Safi","Tamzoura","Terga"],
47:["Ghardaïa","El Meniaa","Dhayet Ben Dhahoua","Mansoura","Béni Isguen","Bounoura","El Atteuf","Hassi Fehal","Hassi Gara","Metlili","Sebseb","Zelfana"],
48:["Relizane","Oued Rhiou","Mazouna","Sidi M'Hamed Benaouda","Jdiouia","Mendes","Zemmoura","Ain Merane","Ain Tarek","Belaassel Bouzegza","Bendaoud","Beni Dergoun","Beni Zentis","Dar Ben Abdelah","El Guettar","El Hamadna","El Hassi","El Matmar","Had Echkalla","Kalaa","Lahlef","Mazine","Meridja","Ouarizane","Oued El Djemaa","Oued Essalem","Ramka","Sidi Abdelkader","Sidi Ali","Sidi Bouzid","Sidi Khettab","Sidi Saada","Yellel"],
49:["Timimoun","Ouled Said","Charouine","Tinerkouk","Ksar Kaddour","Bouda","Ouled Ahmed Tammi","Aougrout","Deldoul","Metarfa","Sebaa","Talmine"],
50:["Bordj Badji Mokhtar","Timiaouine"],
51:["Ouled Djellal","Sidi Khaled","Besbes","Doucen","Lichana","Chetma","Sidi Okba","M'Lili","Foughala","Tolga","El Kantara","Biskra","Ourlal","M'Chounèche","Bordj Ben Azzouz","El Feidh","El Ghrous","El Outaya","Hassi Bahbah","Khenguet Sidi Nadji","Oumache","Zeribet El Oued","Ain Naga","Bouchagroun","Branis","Chaiba","Ain Zaatout"],
52:["Béni Abbès","Tamtert","Kerzaz","El Ouata","Beni Ikhlef","Mechraa Houari Boumediene","Lahmar","Boukaïs","El Beïda","Tabelbala","Igli"],
53:["In Salah","Foggaret Ezzoua","Ain Salah","Ain El Beida","Ain El Hadj","Ain El Kebira"],
54:["In Guezzam","Tin Zouatine"],
55:["Touggourt","Témacine","El Alia","Sidi Slimane","MNaguer","Tamacine","Benaceur","El Allia","Megarine","Nezla","Ouargla","Hassi Messaoud","Rouissat","El Borma","N'Goussa","Hassi Ben Abdellah","Sidi Khouiled","Ain Beida","El Hajira","M'Ziraa","Tebesbest","Zaouia El Abidia"],
56:["Djanet","Bordj El Haouas","Illizi","Debdeb","Bordj Omar Driss","In Amenas"],
57:["El M'Ghair","Djamaa","Sidi Amrane","M'Rara","Tendla","Reguiba","Still","Oued El Alenda","El Oued","Guemar","Debila","Robbah","Bayadha","Douar El Ma","Hassi Khalifa","Kouinine","Nakhla","Oum Touyour","Sidi Aoun","Taghzout","Trifaoui"],
58:["El Meniaa","Hassi Fehal","Bel Bahri","Hassi Gara","Ghardaïa","Bounoura","El Atteuf","Mansoura","Béni Isguen","Dhayet Ben Dhahoua","Metlili","Sebseb","Zelfana"]

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
