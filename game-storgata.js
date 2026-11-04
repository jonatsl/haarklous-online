/* KIWI Storgata (issue #65): the regulars who hang around outside Kiwi Storgata 33 – a bit worn out, kind and funny – give you
 * small quests that use the rest of the game, and Sopp-Sigvald, the mushroom wizard on the corner, teaches you magic once
 * Storgata trusts you (GameMagic). Talk with □ / E; the conversation is in Norwegian with an English translation.
 *   Kjell-Arne, retired sailor       ten empty bottles for the deposit (□ on bottles round Storgata, or drink a soda)
 *   Bente, ex opera chorus singer    her late husband's harmonica, forgotten on the Opera roof
 *   Tore and his dog Laika           a hot coffee and a hot dog from the counter inside the Kiwi
 *   Mona, ex postwoman               a note for her brother Rolf, who feeds the pigeons at Schous plass
 *   Even, retired press photographer a photo of Grønland kirke, where he married in 1981 (the photo camera, △)
 *   Sopp-Sigvald                     four lessons, each after a mushroom hunt: Torshovdalen, Akerselva, the catacomb, MUNCH;
 *                                    lesson k needs the trust of k regulars (each finished quest above is one)
 * Saved in localStorage 'haarklous-storgata-v1' (part of an account's saved progress, GameProgress; MERGE joins two copies).
 *
 * Pure (Node-tested):
 *   PEOPLE, QUESTS, PICKUPS, KEY, fresh(), normalize(raw), status(st, id), trust(st), lesson(st), pickupsOf(questId)
 *   talk(st, who, ctx) -> {name, about, lines [{no, en}], options [{no, en, act, quest}]}   ctx = {pant, bag {id: n}, seed}
 *   perform(st, who, option, ctx, now) -> {lines, reward?, accepted?, error?}   reward = {kr, item, takePant, takeItems, teach}
 *   pick(st, pickupId) -> {quest, count, need, ready} | null     photo(st, spotId) -> quest id | null
 *   goal(st, questId, ctx) -> {no, en}    merge(a, b) (texts) MERGE    hasProgress(st)
 * GameStorgata.create({T, lib, avatars, world, groundAt, front, places, root, audio}) -> browser part (see the end).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GameStorgata = api;
})(typeof window === 'undefined' ? globalThis : window, function () {
  'use strict';
  const KEY = 'haarklous-storgata-v1';
  const L = (no, en) => ({no, en});
  const BYE = {...L('Ha det!', 'Bye!'), act: 'bye'};

  // Where they are: a = metres along the shop's wall from the shop front's west corner, o = metres out from the wall.
  const PEOPLE = {
    even: {name: 'Even', about: L('pensjonert pressefotograf, 66', 'retired press photographer, 66'), color: 0x4b5a3c, place: {a: -13, o: .55}, seat: .45},
    bente: {name: 'Bente', about: L('tidligere kordame i Operaen, 58', 'once in the Opera chorus, 58'), color: 0x8e2b62, place: {a: -8.6, o: .55}},
    kjell: {name: 'Kjell-Arne', about: L('pensjonert sjømann, 62', 'retired sailor, 62'), color: 0x23406e, place: {a: -3.6, o: .55}, seat: .45},
    tore: {name: 'Tore', about: L('og hunden Laika, 55', 'and his dog Laika, 55'), color: 0x5b4636, place: {a: 17.8, o: .6}, seat: .47},
    mona: {name: 'Mona', about: L('tidligere postbud, 60', 'retired postwoman, 60'), color: 0xc0392b, place: {a: 22.2, o: .6}, seat: .45},
    sigvald: {name: 'Sopp-Sigvald', about: L('soppmagiker, «omtrent 400 år»', 'mushroom wizard, "about 400 years old"'), color: 0x4a2a7a, place: {a: 28, o: 1.5}, wizard: true},
    rolf: {name: 'Rolf', about: L('Monas bror, venn av duene', "Mona's brother, friend of the pigeons"), color: 0x3c5a7a, away: 'rolf', seat: .47}
  };
  const REGULARS = ['kjell', 'bente', 'tore', 'mona', 'even'];
  const QUESTS = [
    {id: 'kjell', who: 'kjell', kind: 'pant', need: 10, title: L('Ti tomflasker', 'Ten empty bottles'), reward: {item: 'kvikklunsj', takePant: 10}},
    {id: 'bente', who: 'bente', kind: 'find', title: L('Arvids munnspill', "Arvid's harmonica"), reward: {kr: 100}},
    {id: 'tore', who: 'tore', kind: 'buy', items: ['kaffekopp', 'polse'], title: L('Kaffe og pølse', 'Coffee and a hot dog'), reward: {item: 'solo', takeItems: ['kaffekopp', 'polse']}},
    {id: 'mona', who: 'mona', kind: 'deliver', title: L('En lapp til Rolf', 'A note for Rolf'), reward: {kr: 80}},
    {id: 'even', who: 'even', kind: 'photo', spot: 'gronland', title: L('Grønland kirke', 'Grønland kirke'), reward: {kr: 120}},
    {id: 'w1', who: 'sigvald', kind: 'find', trust: 1, teach: 'levitate', title: L('Stjernesopp i Torshovdalen', 'Star mushrooms in Torshovdalen')},
    {id: 'w2', who: 'sigvald', kind: 'find', trust: 2, teach: 'blink', title: L('Elvesopp langs Akerselva', 'River mushrooms along Akerselva')},
    {id: 'w3', who: 'sigvald', kind: 'find', trust: 3, teach: 'gust', title: L('Beinsoppen i katakomben', 'The bone mushroom in the catacomb')},
    {id: 'w4', who: 'sigvald', kind: 'find', trust: 4, teach: 'orb', title: L('Månesoppen ved MUNCH', 'The moon mushroom at MUNCH')}
  ];
  const quest = id => QUESTS.find(q => q.id === id);
  // Things to find; the game places them (places.pickups[id] = world position) and shows each only while its quest is on.
  const PICKUPS = [
    {id: 'harmonica', quest: 'bente', name: L('Arvids munnspill', "Arvid's harmonica"), kind: 'harmonica'},
    {id: 'dalen-1', quest: 'w1', name: L('stjernesopp', 'star mushroom'), kind: 'star'}, {id: 'dalen-2', quest: 'w1', name: L('stjernesopp', 'star mushroom'), kind: 'star'}, {id: 'dalen-3', quest: 'w1', name: L('stjernesopp', 'star mushroom'), kind: 'star'},
    {id: 'elva-1', quest: 'w2', name: L('elvesopp', 'river mushroom'), kind: 'river'}, {id: 'elva-2', quest: 'w2', name: L('elvesopp', 'river mushroom'), kind: 'river'}, {id: 'elva-3', quest: 'w2', name: L('elvesopp', 'river mushroom'), kind: 'river'},
    {id: 'bein-1', quest: 'w3', name: L('beinsoppen', 'the bone mushroom'), kind: 'bone'},
    {id: 'mane-1', quest: 'w4', name: L('månesoppen', 'the moon mushroom'), kind: 'moon'}
  ];
  const pickupsOf = id => PICKUPS.filter(p => p.quest === id);

  // ---------- State ----------
  const fresh = () => ({v: 1, q: {}, got: {}, powers: {}, met: {}});
  const STATES = ['none', 'active', 'ready', 'done'];
  function normalize(raw) {
    const st = fresh(), r = raw && typeof raw === 'object' ? raw : {};
    for (const [id, x] of Object.entries(r.q || {})) if (quest(id) && x && STATES.includes(x.s) && x.s !== 'none') st.q[id] = {s: x.s, at: +x.at || 0, ...(x.done ? {done: +x.done} : {})};
    for (const id of Object.keys(r.got || {})) if (PICKUPS.some(p => p.id === id)) st.got[id] = 1;
    for (const [id, at] of Object.entries(r.powers || {})) if (['levitate', 'blink', 'gust', 'orb'].includes(id)) st.powers[id] = +at || 1;
    for (const id of Object.keys(r.met || {})) if (PEOPLE[id]) st.met[id] = 1;
    return st;
  }
  const status = (st, id) => (st.q[id] && st.q[id].s) || 'none';
  const trust = st => REGULARS.filter(id => status(st, id) === 'done').length;
  // The wizard's next lesson: the first one not finished, and whether Storgata trusts you enough for it.
  function lesson(st) {const q = QUESTS.filter(q => q.who === 'sigvald').find(q => status(st, q.id) !== 'done');return q ? {q, ok: trust(st) >= q.trust} : null;}
  const hasProgress = st => !!st && (Object.keys(st.q || {}).length > 0 || Object.keys(st.powers || {}).length > 0 || Object.keys(st.got || {}).length > 0);
  const missing = (q, bag) => (q.items || []).filter(id => !((bag || {})[id] > 0));
  function ready(st, id, ctx = {}) {
    const q = quest(id), s = status(st, id);if (s === 'ready') return true;if (s !== 'active') return false;
    if (q.kind === 'pant') return (ctx.pant || 0) >= q.need;
    if (q.kind === 'buy') return missing(q, ctx.bag).length === 0;
    return false;
  }
  const PRODUCT_NO = {kaffekopp: 'kaffe', polse: 'pølse i lompe'}, PRODUCT_EN = {kaffekopp: 'a coffee', polse: 'a hot dog'};
  // What the HUD says you are doing for a quest.
  function goal(st, id, ctx = {}) {
    const q = quest(id), s = status(st, id);
    if (s === 'ready') return L(`Gå tilbake til ${PEOPLE[q.who].name} i Storgata`, `Go back to ${PEOPLE[q.who].name} in Storgata`);
    if (q.kind === 'pant') {const n = Math.min(q.need, ctx.pant || 0);return n >= q.need ? L('Gi Kjell-Arne ti tomflasker', 'Give Kjell-Arne ten empty bottles') : L(`Tomflasker: ${n} av ${q.need}`, `Empty bottles: ${n} of ${q.need} (□ on bottles round Storgata, or drink a soda)`);}
    if (q.kind === 'buy') {const m = missing(q, ctx.bag);return m.length ? L(`Kjøp ${m.map(i => PRODUCT_NO[i]).join(' og ')} på Kiwi`, `Buy ${m.map(i => PRODUCT_EN[i]).join(' and ')} at the Kiwi counter`) : L('Gi Tore kaffen og pølsa', 'Give Tore the coffee and the hot dog');}
    if (q.kind === 'deliver') return L('Gi Monas lapp til Rolf på Schous plass', "Give Mona's note to Rolf at Schous plass");
    if (q.kind === 'photo') return L('Ta et bilde av Grønland kirke (hele tårnet)', 'Take a photo of Grønland kirke (the whole tower) with the camera');
    if (id === 'bente') return L('Finn munnspillet på Operataket', 'Find the harmonica at the top of the Opera roof');
    const ps = pickupsOf(id), k = ps.filter(p => st.got[p.id]).length;
    return L(`${k} av ${ps.length} funnet – følg veipunktet`, `${k} of ${ps.length} found – follow the waypoint`);
  }

  // ---------- Conversations ----------
  const RAMBLE = [
    L('Soppene snakker, vet du. Mest om været. Og om trikken. De hater trikken.', 'The mushrooms talk, you know. Mostly about the weather. And the tram. They hate the tram.'),
    L('Jeg gikk i lære hos en trollmann i Nordmarka i 1974. Eller var det 1874? Tiden er en sopp.', 'I was apprenticed to a wizard in Nordmarka in 1974. Or was it 1874? Time is a mushroom.'),
    L('Duene her er spioner. Jeg har bevis. Bevisene er også duer.', 'The pigeons here are spies. I have proof. The proof is also pigeons.'),
    L('Har du sett hatten min? … Å. Den sitter på hodet. Takk skal du ha.', "Have you seen my hat? … Oh. It's on my head. Thank you."),
    L('Aldri spis en sopp du ikke kjenner! Magi kommer fra vennlighet, ikke fra magen.', 'Never eat a mushroom you do not know! Magic comes from kindness, not from your stomach.'),
    L('Visste du at en kiwi er en fugl som ikke kan fly? Akkurat som meg før frokost.', "Did you know a kiwi is a bird that can't fly? Just like me before breakfast.")
  ];
  const IDLE = {
    kjell: [L('Har jeg fortalt om da jeg rundet Kapp Horn med en papegøye som bare kunne banne på portugisisk?', 'Did I tell you about rounding Cape Horn with a parrot that could only swear in Portuguese?'),
      L('Havet og Storgata er like, vet du. Begge er salte, og begge har måker.', 'The sea and Storgata are alike, you know. Both are salty, and both have seagulls.'), L('Takk for flaskene, matros!', 'Thanks for the bottles, sailor!')],
    bente: [L('Tralalaaa… Unnskyld, bare oppvarming.', 'Tralalaaa… Sorry, just warming up.'), L('Kom tilbake i morgen, så synger jeg Habanera for deg.', "Come back tomorrow and I'll sing the Habanera for you."),
      L('Bravo! Bravissimo! … Det var til deg, altså.', 'Bravo! Bravissimo! … That was for you, by the way.')],
    tore: [L('Laika liker deg. Hun liker ikke mange. Postmannen, for eksempel: nei.', "Laika likes you. She doesn't like many people. The postman, for example: no."), L('Mm. Fint vær for kaffe.', 'Mm. Nice weather for coffee.')],
    mona: [L('Rolf og jeg skal fiske på søndag. Med to fiskestenger!', 'Rolf and I are going fishing on Sunday. With two fishing rods!'), L('Visste du at postkassen på hjørnet er fra 1962? Nå vet du det.', 'Did you know the letterbox on the corner is from 1962? Now you do.')],
    even: [L('Husk: det beste bildet er det du tar i dag.', 'Remember: the best photo is the one you take today.'), L('Se på lyset over Storgata nå. Klikk.', 'Look at the light over Storgata now. Click.')],
    rolf: [L('Duene og jeg, vi forstår hverandre. De sier aldri noe dumt om fiskestenger.', 'The pigeons and I understand each other. They never say anything silly about fishing rods.')]
  };
  const INTRO = {
    kjell: L('Ahoi! Kjell-Arne. Tjue år på sjøen – nå seiler jeg på fortauet.', 'Ahoy! Kjell-Arne. Twenty years at sea – now I sail the pavement.'),
    bente: L('Å, en tilskuer! Bente, tretti år i operakoret. Jeg har sunget Carmen førti ganger – i koret, men likevel.', "Oh, an audience! Bente, thirty years in the opera chorus. I've sung Carmen forty times – in the chorus, but still."),
    tore: L('Mm. Tore. Og dette er Laika. Hun er sjefen, jeg er bare sjåføren.', "Mm. Tore. And this is Laika. She's the boss, I'm just the driver."),
    mona: L('Hei, vennen. Mona. Trettien år i Posten – jeg kjenner hver eneste postkasse i Gamle Oslo.', 'Hi, dear. Mona. Thirty-one years at the Post – I know every letterbox in Old Oslo.'),
    even: L('Even. Pressefotograf i førti år. Nå tar jeg bilder med øynene – film er så dyrt.', 'Even. Press photographer for forty years. Now I take pictures with my eyes – film is so expensive.'),
    sigvald: L('Aha! En sjel med gode sko! Sopp-Sigvald, magiker, soppvenn og rådgiver for duer.', 'Aha! A soul with good shoes! Sopp-Sigvald, wizard, friend of mushrooms and adviser to pigeons.'),
    rolf: L('Hm? Rolf. Jeg mater duene. Duene mater meg med selskap.', 'Hm? Rolf. I feed the pigeons. The pigeons feed me company.')
  };
  const OFFER = {
    kjell: [L('Ryggen min er ikke hva den var. Kan du samle ti tomflasker for meg? Folk slenger dem rundt her i Storgata.', "My back isn't what it was. Could you collect ten empty bottles for me? People leave them all over Storgata."), L('Klart, jeg finner dem!', "Sure, I'll find them!")],
    bente: [L('I går sang jeg på Operataket, og der glemte jeg munnspillet etter min Arvid. Bakkene er for bratte for knærne mine i dag. Kan du hente det?', "Yesterday I sang on the Opera roof, and I left my Arvid's harmonica up there. The slopes are too steep for my knees today. Could you fetch it?"), L('Jeg henter det!', "I'll fetch it!")],
    tore: [L('Det er kaldt i dag. Kan du kjøpe en kaffe til meg og en pølse i lompe til Laika? Det er en disk ved vinduet inne på Kiwi. Pølsa er til Laika. Ærlig talt.', "It's cold today. Could you buy me a coffee and a hot dog for Laika? There's a counter by the window inside the Kiwi. The hot dog is for Laika. Honestly."), L('Kaffe og pølse, kommer straks!', 'Coffee and a hot dog, coming right up!')],
    mona: [L('Broren min Rolf mater duene på Schous plass hver dag. Vi har ikke snakket sammen siden en dum krangel om en fiskestang. Kan du gi ham denne lappen?', "My brother Rolf feeds the pigeons at Schous plass every day. We haven't spoken since a silly row about a fishing rod. Could you give him this note?"), L('Jeg leverer den!', "I'll deliver it!")],
    even: [L('Jeg giftet meg i Grønland kirke i 1981. Knærne mine klarer ikke turen dit lenger. Vil du ta et bilde av kirken for meg? Hele tårnet, takk.', "I got married in Grønland kirke in 1981. My knees can't manage the walk any more. Would you take a picture of the church for me? The whole tower, please."), L('Jeg tar bildet!', "I'll take the picture!")],
    w1: [L('Folk i Storgata sier du er snill. Godt! I Torshovdalen gløder tre stjernesopper. Hent dem, så lærer jeg deg å sveve.', 'People in Storgata say you are kind. Good! Three star mushrooms glow in Torshovdalen. Bring them to me and I will teach you to float.'), L('Jeg finner soppene!', "I'll find the mushrooms!")],
    w2: [L('Langs Akerselva vokser elvesopp som har lært seg å hoppe over steiner. Tre stykker, takk. Da lærer du Glimt.', 'Along Akerselva grow river mushrooms that have learned to skip over stones. Three of them, please. Then you will learn Blink.'), L('Til elva!', 'To the river!')],
    w3: [L('Dypt under Torshovdalen, i katakomben, står beinsoppen i Rotunden. Den er gammel og gretten. Si at Sigvald hilser – og ta den med. Da lærer du Vindkast.', 'Deep under Torshovdalen, in the catacomb, the bone mushroom stands in the Rotunda. It is old and grumpy. Tell it Sigvald says hello – and bring it. Then you will learn Gust.'), L('Ned i mørket, da.', 'Down into the dark, then.')],
    w4: [L('Den siste: månesoppen ved foten av MUNCH, der fjorden glitrer. Med den lærer du Lyskule.', 'The last one: the moon mushroom at the foot of MUNCH, where the fjord glitters. With it you will learn Light orb.'), L('Jeg henter månesoppen!', "I'll fetch the moon mushroom!")]
  };
  const ACTIVE = {
    bente: L('Munnspillet ligger helt øverst på Operataket. Veipunktet viser veien – gå opp den hvite bakken.', 'The harmonica is at the very top of the Opera roof. The waypoint shows the way – walk up the white slope.'),
    mona: L('Rolf sitter på en benk på Schous plass, ved bordtennisbordet i Grünerløkka. Lue med dusk. Følg veipunktet.', 'Rolf sits on a bench at Schous plass, by the table tennis table in Grünerløkka. Bobble hat. Follow the waypoint.'),
    even: L('Grønland kirke, med det høye tårnet, øst for Grønland T-bane. Ta bildet med kameraet (△) og få med hele tårnet.', 'Grønland kirke, the one with the tall tower, east of Grønland T-bane. Take it with the camera (△) and get the whole tower in.')
  };
  const READY = {kjell: L('Gi ham ti tomflasker', 'Give him ten empty bottles'), bente: L('Gi henne munnspillet', 'Give her the harmonica'), tore: L('Gi dem kaffen og pølsa', 'Give them the coffee and the hot dog'),
    mona: L('Fortell hva Rolf sa', 'Tell her what Rolf said'), even: L('Vis ham bildet', 'Show him the photo'), sigvald: L('Gi ham soppene', 'Give him the mushrooms'), sigvald1: L('Gi ham soppen', 'Give him the mushroom')};
  const THANKS = {
    kjell: L('Ti flasker! Tjue kroner i pant – det blir kaffe i morgen. Her, ta Kvikk Lunsjen min. Du har fortjent den, matros.', "Ten bottles! Twenty kroner of deposit – that's coffee tomorrow. Here, have my Kvikk Lunsj. You've earned it, sailor."),
    bente: L('Arvid! Du er hjemme igjen. … Her, ta hundre kroner. Nei, ikke si nei – en primadonna insisterer!', "Arvid! You're home again. … Here, take a hundred kroner. No, don't say no – a prima donna insists!"),
    tore: L('Varm kaffe… Du er et godt menneske. Laika, si takk! … Hun sier takk. Ta denne Soloen – jeg fant to.', "Hot coffee… You're a good person. Laika, say thank you! … She says thanks. Have this Solo – I found two."),
    mona: L('Sa han det? At han savner meg? Å, den dumme gamle torsken… Her, åtti kroner for portoen. Og tusen takk.', 'He said that? That he misses me? Oh, the silly old cod… Here, eighty kroner for the postage. And thank you so much.'),
    even: L('La meg se… Ja. Akkurat sånn så den ut. Lyset er fint – du har øye for det. Her, hundre og tjue kroner, mitt siste fotohonorar.', "Let me see… Yes. That's just how it looked. Lovely light – you have an eye for it. Here, a hundred and twenty kroner, my last photo fee.")
  };
  const TEACH = {
    levitate: L('Pust inn. Tenk på en fjær. Tenk på en fjær som tenker på en sky. Hold R1 (eller 1)… Sånn! Du svever!', 'Breathe in. Think of a feather. Think of a feather thinking of a cloud. Hold R1 (or 1)… There! You are floating!'),
    blink: L('Se dit du vil. Blunk med hele kroppen. R1 (eller 2) – glimt! Ikke gjennom vegger, det gjør vondt.', 'Look where you want to go. Blink with your whole body. R1 (or 2) – blink! Not through walls, that hurts.'),
    gust: L('Blås som en nordavind med dårlig humør! R1 (eller 3) dytter biler, sparkesykler og duer. Mest duer.', 'Blow like a grumpy north wind! R1 (or 3) pushes cars, scooters and pigeons. Mostly pigeons.'),
    orb: L('Hold lyset i hånden og slipp det løs. R1 (eller 4) tenner og slukker Lyskula. Fin i katakomben!', 'Hold the light in your hand and let it go. R1 (or 4) lights and puts out the light orb. Lovely in the catacomb!')
  };
  const pickLine = (list, seed) => list[((seed | 0) % list.length + list.length) % list.length];

  function talk(st, who, ctx = {}) {
    const P = PEOPLE[who];if (!P) return null;
    const out = {name: P.name, about: P.about, lines: [], options: []}, seed = ctx.seed || 0;
    if (!st.met[who]) out.lines.push(INTRO[who]);
    if (who === 'rolf') {
      const s = status(st, 'mona');
      if (s === 'active') {out.lines.push(L('En lapp? Til meg? Hvem i all verden …', 'A note? For me? Who on earth …'));out.options.push({...L('Gi ham Monas lapp', "Give him Mona's note"), act: 'deliver', quest: 'mona'});}
      else if (s === 'ready' || s === 'done') out.lines.push(L('Si hei til Mona. Og si at duene hilser.', 'Say hi to Mona. And tell her the pigeons send their regards.'));
      else out.lines.push(pickLine(IDLE.rolf, seed));
      out.options.push(BYE);return out;
    }
    if (who === 'sigvald') {
      out.lines.push(pickLine(RAMBLE, seed));
      const ls = lesson(st);
      if (!ls) {out.lines.push(L('Du er nå Mester av Storgata! Bruk kreftene vennlig. Og ikke si noe til duene.', 'You are now Master of Storgata! Use your powers kindly. And do not tell the pigeons anything.'));out.options.push(BYE);return out;}
      const s = status(st, ls.q.id);
      if (s === 'none' && !ls.ok) out.lines.push(L(`Folk i Storgata vet hvem som har et godt hjerte. Hjelp dem, så snakker vi om magi. Tillit: ${trust(st)} av ${ls.q.trust}.`, `The people of Storgata know who has a good heart. Help them, and then we will talk magic. Trust: ${trust(st)} of ${ls.q.trust}.`));
      else if (s === 'none') {out.lines.push(OFFER[ls.q.id][0]);out.options.push({...OFFER[ls.q.id][1], act: 'accept', quest: ls.q.id});}
      else if (s === 'active') {const ps = pickupsOf(ls.q.id), k = ps.filter(p => st.got[p.id]).length;out.lines.push(L(`Soppene venter. ${k} av ${ps.length} funnet. Veipunktet viser den neste.`, `The mushrooms are waiting. ${k} of ${ps.length} found. The waypoint shows the next one.`));}
      else if (s === 'ready') {out.lines.push(L('Jeg kjenner lukten av sopp! Har du dem?', 'I smell mushrooms! Do you have them?'));out.options.push({...(pickupsOf(ls.q.id).length > 1 ? READY.sigvald : READY.sigvald1), act: 'complete', quest: ls.q.id});}
      out.options.push(BYE);return out;
    }
    const q = quest(who), s = status(st, who);
    if (s === 'none') {out.lines.push(OFFER[who][0]);out.options.push({...OFFER[who][1], act: 'accept', quest: who});}
    else if (s === 'done') out.lines.push(pickLine(IDLE[who], seed));
    else if (ready(st, who, ctx)) {out.lines.push(L('Å! Har du det?', 'Oh! Have you got it?'));out.options.push({...READY[who], act: 'complete', quest: who});}
    else if (q.kind === 'pant') out.lines.push(L(`Du har ${Math.min(ctx.pant || 0, q.need)} av ti. Se langs fortauene – og en brus gir også en flaske!`, `You have ${Math.min(ctx.pant || 0, q.need)} of ten. Look along the pavements – and a soda gives you a bottle too!`));
    else if (q.kind === 'buy') {const m = missing(q, ctx.bag);out.lines.push(L(`Kaffe og pølse i lompe fra disken ved vinduet inne på Kiwi. Du mangler: ${m.map(i => PRODUCT_NO[i]).join(' og ')}. Laika ser på deg.`, `Coffee and a hot dog from the counter by the window inside the Kiwi. Still missing: ${m.map(i => PRODUCT_EN[i]).join(' and ')}. Laika is watching you.`));}
    else out.lines.push(ACTIVE[who]);
    out.options.push(BYE);return out;
  }

  // The chosen option: accept a quest, finish it (the reward, which the game pays out), or hand Mona's note to Rolf.
  function perform(st, who, opt, ctx = {}, now = Date.now()) {
    st.met[who] = 1;
    if (!opt || opt.act === 'bye') return {lines: []};
    const q = quest(opt.quest);if (!q) return {error: 'no quest', lines: []};
    if (opt.act === 'accept') {
      if (status(st, q.id) !== 'none') return {error: 'taken', lines: []};
      if (q.who === 'sigvald') {const ls = lesson(st);if (!ls || ls.q.id !== q.id || !ls.ok) return {error: 'trust', lines: []};}
      st.q[q.id] = {s: 'active', at: now};
      // Things found before (a copy of the progress from another PC) still count.
      const ps = pickupsOf(q.id);if (ps.length && ps.every(p => st.got[p.id])) st.q[q.id].s = 'ready';
      return {accepted: q.id, lines: [L('Tusen takk!', 'Thank you so much!')]};
    }
    if (opt.act === 'deliver') {
      if (q.id !== 'mona' || status(st, 'mona') !== 'active') return {error: 'no note', lines: []};
      st.q.mona.s = 'ready';
      return {delivered: true, lines: [L('«Unnskyld for fiskestanga.» Hm. Si at hun kan få den tilbake. Og… at jeg savner henne.', '"Sorry about the fishing rod." Hm. Tell her she can have it back. And… that I miss her.')]};
    }
    if (opt.act === 'complete') {
      if (!ready(st, q.id, ctx)) return {error: 'not ready', lines: []};
      st.q[q.id] = {s: 'done', at: st.q[q.id].at, done: now};
      const reward = {...(q.reward || {})};
      if (q.teach) {st.powers[q.teach] = now;reward.teach = q.teach;}
      const lines = q.teach ? [L('Ahh, de nynner! Nå, hør godt etter …', 'Ahh, they are humming! Now listen carefully …'), TEACH[q.teach]] : [THANKS[q.id]];
      if (q.teach && q.id !== 'w4') lines.push(L('D-pad ← (eller ←) velger kraft. Mana fylles opp av seg selv.', 'D-pad ← (or ←) chooses the power. Your mana refills by itself.'));
      return {lines, reward, done: q.id};
    }
    return {error: 'unknown', lines: []};
  }

  function pick(st, id) {
    const p = PICKUPS.find(x => x.id === id);if (!p || st.got[id] || status(st, p.quest) !== 'active') return null;
    st.got[id] = 1;const ps = pickupsOf(p.quest), count = ps.filter(x => st.got[x.id]).length;
    if (count >= ps.length) st.q[p.quest].s = 'ready';
    return {quest: p.quest, count, need: ps.length, ready: count >= ps.length, pickup: p};
  }
  function photo(st, spot) {const q = QUESTS.find(x => x.kind === 'photo' && x.spot === spot && status(st, x.id) === 'active');if (!q) return null;st.q[q.id].s = 'ready';return q.id;}

  // Two copies of the state (an account and a browser, or two PCs) join: the further step of each quest wins, finds, powers and
  // people met add up.
  function merge(A, B) {
    const parse = t => {try {return normalize(JSON.parse(t));} catch {return fresh();}};
    const a = parse(A), b = parse(B), out = fresh();
    for (const id of new Set([...Object.keys(a.q), ...Object.keys(b.q)])) {
      const x = a.q[id], y = b.q[id];out.q[id] = !y ? x : !x ? y : STATES.indexOf(x.s) >= STATES.indexOf(y.s) ? x : y;
    }
    out.got = {...b.got, ...a.got};out.met = {...b.met, ...a.met};
    for (const id of new Set([...Object.keys(a.powers), ...Object.keys(b.powers)])) out.powers[id] = Math.min(a.powers[id] || Infinity, b.powers[id] || Infinity);
    return JSON.stringify(out);
  }
  const MERGE = {[KEY]: merge};

  // ---------- Browser ----------
  // front = the shop notch {P0, u, n, W} in local metres; rolf = {x, z, yaw} (world) for his bench at Schous plass. The finds and the
  // bottles are placed by the game once the walk world exists (place(...)). groundAt(x, z) gives world heights.
  function create({T, lib, avatars, world, groundAt, front, rolf, root, audio}) {
    const group = new T.Group();group.name = 'Storgata';
    const W = (x, s) => world.toWorld(x, s), along = (a, o) => [front.P0[0] + front.u[0] * a - front.n[0] * o, front.P0[1] + front.u[1] * a - front.n[1] * o];
    // The street side is -n in local metres; in the world that is a yaw for a figure facing -z.
    const outW = (() => {const p = W(...along(0, 0)), q = W(...along(0, 1));return Math.atan2(-(q.x - p.x), -(q.z - p.z));})();
    const obstacles = [], hitboxes = [], people = {};
    const hitM = new T.MeshBasicMaterial({visible: false});
    const mats = {
      white: new T.MeshStandardMaterial({color: 0xf1f1ec, roughness: .9}), grey: new T.MeshStandardMaterial({color: 0x9a9a96, roughness: .9}), red: new T.MeshStandardMaterial({color: 0xc3241c, roughness: .55}),
      crate: lib.polymer(0x2f5d8a), card: new T.MeshStandardMaterial({color: 0xb28b5a, roughness: 1}), wood: lib.wood(0x6b4a33, .7), metal: lib.metal(0x7d8186, .4), dark: lib.polymer(0x232528),
      robe: lib.fabric(0x4a2a7a), star: new T.MeshStandardMaterial({color: 0xffe066, emissive: 0xffc400, emissiveIntensity: .6}), glow: new T.MeshStandardMaterial({color: 0xe0ffd0, emissive: 0x9dff6a, emissiveIntensity: 1.6}),
      fur: new T.MeshStandardMaterial({color: 0x8a6a48, roughness: 1}), furDark: new T.MeshStandardMaterial({color: 0x3d2c1f, roughness: 1}), blanket: lib.fabric(0x7a2f2f), can: new T.MeshStandardMaterial({color: 0xf7941d, roughness: .3, metalness: .6}),
      scarf: lib.fabric(0xe0a020), bag: lib.fabric(0xd0021b), beanie: lib.fabric(0x1f4f8f), bobble: lib.fabric(0xd8452b), cap: lib.fabric(0x3c3c3c), green: new T.MeshStandardMaterial({color: 0x3f7f35, roughness: .8}), pink: new T.MeshStandardMaterial({color: 0xe9457a, roughness: .7})
    };
    const mesh = (parent, geo, mat, x = 0, y = 0, z = 0) => {const m = new T.Mesh(geo, mat);m.position.set(x, y, z);m.castShadow = true;parent.add(m);return m;};
    const box = (parent, w, h, d, mat, x, y, z) => mesh(parent, new T.BoxGeometry(w, h, d), mat, x, y, z);
    const cyl = (parent, r0, r1, h, mat, x, y, z, seg = 12) => mesh(parent, new T.CylinderGeometry(r0, r1, h, seg), mat, x, y, z);
    const sph = (parent, r, mat, x, y, z, ws = 12, hs = 8) => mesh(parent, new T.SphereGeometry(r, ws, hs), mat, x, y, z);
    // A person: the game's avatar, posed once and merged; the head stays a separate group so it can turn. The regulars' bodies are
    // merged together into one set of meshes (crowd, below), the wizard and Rolf each on their own (the wizard sways).
    const eyeM = new T.MeshStandardMaterial({color: 0x222222}), crowd = new T.Group();crowd.name = 'Storgata regulars';group.add(crowd);
    function person(id, at, yaw, {stance = 'stand', seat = 0, dress, own = false} = {}) {
      const P = PEOPLE[id], av = avatars.avatar(id === 'sigvald' ? 4 : 7, P.name, P.color), g = av.group;
      const y = groundAt(at.x, at.z);g.position.set(at.x, y + (stance === 'sit' ? seat + .02 : 0), at.z);g.rotation.y = yaw;av.pose({stance});
      const head = av.joints.head;head.userData.noMerge = true;
      if (dress) dress(g, head, av);
      // One eye material for everybody, and no shadows from the heads (fewer draw calls).
      head.traverse(o => {if (o.isMesh) {o.castShadow = false;if (o.material.color && o.material.color.getHex() === 0x222222 && !o.material.map) o.material = eyeM;}});
      g.updateMatrixWorld(true);lib.mergeStatic(head);if (own) lib.mergeStatic(g);
      const hit = new T.Mesh(new T.BoxGeometry(.8, 1.7, .8), hitM);hit.position.set(0, stance === 'sit' ? .35 : .85, 0);hit.userData = {storgata: id, noMerge: true};g.add(hit);hitboxes.push(hit);
      (own ? group : crowd).add(g);
      const p = people[id] = {id, av, g, head, base: head.rotation.y, at: {x: at.x, y, z: at.z}, yaw, talkT: 0};
      return p;
    }
    // Walk obstacle round a spot (world): a box of half-size hx × hz turned by yaw.
    function block(at, yaw, hx, hz, h = 1.6) {
      const c = Math.cos(yaw), s = Math.sin(yaw), y = groundAt(at.x, at.z);
      obstacles.push({points: [[-hx, -hz], [hx, -hz], [hx, hz], [-hx, hz]].map(([a, b]) => ({x: at.x + c * a + s * b, z: at.z - s * a + c * b})), minY: y - .3, maxY: y + h, kind: 'storgata'});
    }
    const spot = (a, o) => W(...along(a, o));
    const props = new T.Group();props.name = 'Storgata props';group.add(props);
    const prop = (at, yaw) => {const g = new T.Group();g.position.set(at.x, groundAt(at.x, at.z), at.z);g.rotation.y = yaw;props.add(g);return g;};
    // ---- The regulars along the wall, facing the street ----
    {
      const at = spot(PEOPLE.kjell.place.a, PEOPLE.kjell.place.o), yaw = outW + .25;
      const c = prop(at, yaw);box(c, .44, .44, .36, mats.crate, 0, .22, .02);box(c, .5, .02, .5, mats.card, .55, .01, -.1);
      const sign = (() => {const cv = document.createElement('canvas');cv.width = 256;cv.height = 160;const x = cv.getContext('2d');x.fillStyle = '#c9a26b';x.fillRect(0, 0, 256, 160);x.fillStyle = '#2b2118';x.font = 'bold 34px Segoe UI, Arial';x.textAlign = 'center';x.fillText('TAKK FOR', 128, 58);x.fillText('TOMFLASKA :)', 128, 108);const t = new T.CanvasTexture(cv);t.colorSpace = T.SRGBColorSpace;return new T.MeshStandardMaterial({map: t, roughness: 1});})();
      const sg = box(c, .48, .3, .01, sign, -.45, .22, -.18);sg.rotation.x = -.25;cyl(c, .045, .035, .1, mats.white, .42, .05, -.22, 10);
      person('kjell', at, yaw, {stance: 'sit', seat: .44, dress: (g, head) => {
        mesh(head, new T.SphereGeometry(.125, 14, 8, 0, Math.PI * 2, 0, Math.PI * .5), mats.beanie, 0, .045, .01).scale.set(1, .95, 1);
        const beard = mesh(head, new T.SphereGeometry(.085, 10, 8), mats.grey, 0, -.06, -.07);beard.scale.set(1.1, .9, .6);
      }});
      block(at, yaw, .45, .4, 1.4);
    }
    {
      const at = spot(PEOPLE.bente.place.a, PEOPLE.bente.place.o), yaw = outW - .3, t = spot(PEOPLE.bente.place.a + 1.0, .65), ty = outW + Math.PI / 2;
      // Her shopping trolley: wire basket on four wheels, full of bags and a potted geranium.
      const tr = prop(t, ty);box(tr, .55, .02, .4, mats.metal, 0, .32, 0);for (const [x, z] of [[-.27, -.19], [.27, -.19], [-.27, .19], [.27, .19]]) {box(tr, .02, .5, .02, mats.metal, x, .57, z);cyl(tr, .05, .05, .03, mats.dark, x, .05, z, 10).rotation.x = Math.PI / 2;box(tr, .02, .3, .02, mats.metal, x, .17, z);}
      box(tr, .55, .02, .02, mats.metal, 0, .82, -.19);box(tr, .55, .02, .02, mats.metal, 0, .82, .19);box(tr, .02, .02, .4, mats.metal, -.27, .82, 0);box(tr, .02, .02, .4, mats.metal, .27, .82, 0);
      box(tr, .02, .32, .02, mats.metal, .32, 1.0, 0).rotation.z = -.4;box(tr, .02, .02, .42, mats.dark, .38, 1.14, 0);
      box(tr, .25, .3, .2, mats.white, -.12, .5, -.05);box(tr, .22, .28, .2, mats.bag, .13, .5, .06);cyl(tr, .08, .06, .14, mats.card, .1, .9, -.08, 10);sph(tr, .12, mats.green, .1, 1.04, -.08);for (let k = 0; k < 4; k++) sph(tr, .035, mats.pink, .1 + Math.cos(k * 1.6) * .08, 1.12, -.08 + Math.sin(k * 1.6) * .08);
      person('bente', at, yaw, {dress: (g, head) => {
        mesh(head, new T.TorusGeometry(.09, .035, 8, 16), mats.scarf, 0, -.16, 0).rotation.x = Math.PI / 2;
        const hat = mesh(head, new T.CylinderGeometry(.22, .22, .02, 18), mats.pink, 0, .11, 0);hat.rotation.x = -.12;mesh(head, new T.CylinderGeometry(.1, .11, .09, 14), mats.pink, 0, .15, 0);
      }});
      block(at, yaw, .3, .3, 1.8);block(t, ty, .32, .25, 1.2);
    }
    {
      const at = spot(PEOPLE.tore.place.a, PEOPLE.tore.place.o), yaw = outW - .2, d = spot(PEOPLE.tore.place.a + .95, 1.05), dy = outW + Math.PI / 2 - .3;
      const st = prop(at, yaw);box(st, .38, .04, .34, mats.card, 0, .45, .02);for (const sx of [-1, 1]) {const l = box(st, .025, .5, .025, mats.metal, sx * .15, .22, .02);l.rotation.x = .35;const l2 = box(st, .025, .5, .025, mats.metal, sx * .15, .22, .02);l2.rotation.x = -.35;}
      person('tore', at, yaw, {stance: 'sit', seat: .47, dress: (g, head, av) => {
        mesh(head, new T.SphereGeometry(.122, 14, 8, 0, Math.PI * 2, 0, Math.PI * .45), mats.cap, 0, .05, 0);box(head, .2, .02, .12, mats.cap, 0, .07, -.13);
        // A can of Solo in his right hand (the avatar's bottle is a beer bottle).
        const can = cyl(av.joints.R.el, .032, .032, .12, mats.can, 0, -.31, -.03, 10);can.rotation.x = .2;
      }});
      // Laika: a scruffy dog lying on a blanket, head up; her tail wags (its own small mesh).
      const dog = prop(d, dy);dog.name = 'Laika';box(dog, .7, .02, .5, mats.blanket, 0, .01, 0);
      const body = sph(dog, .17, mats.fur, 0, .17, 0, 12, 8);body.scale.set(1, .85, 2.0);
      for (const [x, z] of [[-.1, -.22], [.1, -.22]]) {const l = box(dog, .07, .06, .2, mats.fur, x, .04, z - .08);l.rotation.x = 0;}
      const dh = new T.Group();dh.position.set(0, .32, -.34);dog.add(dh);sph(dh, .1, mats.fur, 0, 0, 0);const snout = sph(dh, .06, mats.fur, 0, -.03, -.09);snout.scale.set(.9, .8, 1.3);sph(dh, .022, mats.furDark, 0, -.02, -.17, 8, 6);
      for (const sx of [-1, 1]) {const ear = box(dh, .05, .1, .03, mats.furDark, sx * .07, .07, .01);ear.rotation.z = sx * .4;sph(dh, .013, mats.furDark, sx * .04, .025, -.085, 6, 4);}
      const tail = new T.Group();tail.position.set(0, .2, .32);dog.add(tail);const tm = box(tail, .04, .04, .24, mats.fur, 0, .03, .11);tm.rotation.x = -.5;
      dh.userData.noMerge = tail.userData.noMerge = true;dog.updateMatrixWorld(true);lib.mergeStatic(dh);lib.mergeStatic(tail);
      people.tore.dog = {head: dh, tail, t: 0};
      block(at, yaw, .3, .3, 1.4);block(d, dy, .3, .45, .6);
    }
    {
      const at = spot(PEOPLE.mona.place.a, PEOPLE.mona.place.o), yaw = outW, b = prop(at, yaw);
      // A bench against the wall; her red Posten bag and a thermos beside her.
      box(b, 1.6, .05, .42, mats.wood, .35, .45, .05);box(b, 1.6, .3, .04, mats.wood, .35, .72, .25);for (const x of [-.35, 1.05]) box(b, .06, .45, .4, mats.metal, x, .22, .05);
      box(b, .32, .26, .12, mats.bag, .75, .6, .05);cyl(b, .045, .045, .26, mats.metal, 1.0, .6, -.02, 10);
      person('mona', at, yaw, {stance: 'sit', seat: .47, dress: (g, head) => {
        mesh(head, new T.SphereGeometry(.13, 14, 10), mats.grey, 0, .01, .03).scale.set(1, 1.1, 1);
        mesh(head, new T.TorusGeometry(.03, .012, 6, 12), mats.dark, -.04, .03, -.105).rotation.y = .1;mesh(head, new T.TorusGeometry(.03, .012, 6, 12), mats.dark, .04, .03, -.105).rotation.y = -.1;
      }});
      const c = Math.cos(yaw), s = Math.sin(yaw), mid = {x: at.x + c * .35, z: at.z - s * .35};block(mid, yaw, .85, .3, 1.0);
    }
    {
      const at = spot(PEOPLE.even.place.a, PEOPLE.even.place.o), yaw = outW + .35, c = prop(at, yaw);box(c, .44, .44, .36, mats.crate, 0, .22, .02);
      person('even', at, yaw, {stance: 'sit', seat: .45, dress: (g, head, av) => {
        mesh(head, new T.CylinderGeometry(.13, .125, .05, 14), mats.cap, 0, .08, 0);box(head, .18, .015, .1, mats.cap, 0, .07, -.12);
        // An old film camera on a strap round his neck.
        const torso = av.joints.head.parent.parent;box(torso, .15, .1, .07, mats.dark, 0, .3, -.17);cyl(torso, .035, .035, .06, mats.metal, 0, .3, -.23, 10).rotation.x = Math.PI / 2;
      }});
      block(at, yaw, .45, .4, 1.4);
    }
    // ---- Sopp-Sigvald, the mushroom wizard: robe, wild white hair and beard, a red-and-white mushroom hat and a staff ----
    {
      const at = spot(PEOPLE.sigvald.place.a, PEOPLE.sigvald.place.o), yaw = outW - .6;
      const p = person('sigvald', at, yaw, {own: true, dress: (g, head, av) => {
        const hips = av.joints.head.parent.parent.parent;
        const robe = cyl(hips, .2, .42, 1.0, mats.robe, 0, -.47, 0, 18);robe.castShadow = true;
        for (let k = 0; k < 9; k++) {const a = k * 2.4, h = -.2 - (k % 3) * .25, r = .26 + ((h + .2) * -.18);const s = box(hips, .05, .05, .01, mats.star, Math.sin(a) * r, h, Math.cos(a) * r);s.rotation.set(0, a, .8);}
        for (let k = 0; k < 9; k++) {const a = k / 9 * Math.PI * 2;sph(head, .06 + (k % 3) * .015, mats.white, Math.sin(a) * .12, .02 + Math.cos(a * 2) * .03, Math.cos(a) * .11 + .02, 8, 6);}
        const beard = mesh(head, new T.ConeGeometry(.09, .34, 10), mats.white, 0, -.2, -.07);beard.rotation.x = Math.PI + .25;
        cyl(head, .07, .085, .12, mats.white, 0, .14, 0, 12);
        // The big fly-agaric hat: a red dome with white spots and pale gills underneath.
        const R = .4, capM = mesh(head, new T.SphereGeometry(R, 24, 12, 0, Math.PI * 2, 0, Math.PI * .5), mats.red, 0, .19, 0);capM.scale.set(1, .78, 1);
        const gills = mesh(head, new T.CircleGeometry(R * .98, 24), mats.white, 0, .189, 0);gills.rotation.x = Math.PI / 2;
        for (let k = 0; k < 14; k++) {const a = k * 2.4, r = (.08 + (k % 4) * .075), yy = .19 + Math.sqrt(Math.max(0, R * R - r * r)) * .6;const d = sph(head, .035 + (k % 2) * .015, mats.white, Math.sin(a) * r * 1.02, .19 + (yy - .19) * 1.3, Math.cos(a) * r * 1.02, 8, 6);d.scale.y = .45;}
        const staff = cyl(av.joints.R.el, .022, .028, 1.7, mats.wood, 0, -.3, -.05, 8);staff.rotation.x = .1;
        const tip = sph(av.joints.R.el, .06, mats.glow, 0, .55, -.12, 10, 8);tip.scale.y = .6;cyl(av.joints.R.el, .015, .02, .05, mats.white, 0, .5, -.11, 8);
      }});
      p.wizard = true;block(at, yaw, .38, .38, 1.9);
    }
    // ---- Rolf on a bench at Schous plass (placed by place(), his own group) ----
    const rolfGroup = new T.Group();rolfGroup.name = 'Rolf';group.add(rolfGroup);let rolfAt = null;
    function placeRolf(at, yaw) {
      rolfAt = {x: at.x, y: groundAt(at.x, at.z), z: at.z};
      const b = new T.Group();b.position.set(at.x, groundAt(at.x, at.z), at.z);b.rotation.y = yaw;rolfGroup.add(b);
      box(b, 1.7, .05, .44, mats.wood, .35, .45, .05);box(b, 1.7, .3, .04, mats.wood, .35, .72, .26);for (const x of [-.4, 1.1]) box(b, .06, .45, .4, mats.metal, x, .22, .05);box(b, .2, .14, .14, mats.card, .8, .54, .05);
      b.updateMatrixWorld(true);lib.mergeStatic(b);
      const p = person('rolf', at, yaw, {stance: 'sit', seat: .47, own: true, dress: (g, head) => {mesh(head, new T.SphereGeometry(.125, 14, 8, 0, Math.PI * 2, 0, Math.PI * .5), mats.bobble, 0, .05, .01);sph(head, .05, mats.white, 0, .18, .01, 8, 6);}});
      group.remove(p.g);rolfGroup.add(p.g);const c = Math.cos(yaw), s = Math.sin(yaw);block({x: at.x + c * .35, z: at.z - s * .35}, yaw, .9, .3, 1.0);
    }
    if (rolf) placeRolf(rolf, rolf.yaw || 0);
    props.updateMatrixWorld(true);lib.mergeStatic(props, o => !!o.userData.noMerge);
    crowd.updateMatrixWorld(true);lib.mergeStatic(crowd);

    // ---- Pigeons: one instanced flock round Storgata's pavement and one round Rolf; they flap off from a gust or a runner ----
    const pigeonGeo = (() => {
      const parts = [new T.SphereGeometry(.075, 10, 6).scale(1, .8, 1.5).translate(0, .085, 0), new T.SphereGeometry(.04, 8, 6).translate(0, .165, -.09), new T.ConeGeometry(.01, .035, 6).rotateX(-Math.PI / 2).translate(0, .158, -.14), new T.BoxGeometry(.075, .012, .1).translate(0, .085, .13)];
      const pos = [], nor = [];for (const p of parts) {const g = p.index ? p.toNonIndexed() : p;pos.push(...g.attributes.position.array);nor.push(...g.attributes.normal.array);}
      const g = new T.BufferGeometry();g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));g.setAttribute('normal', new T.Float32BufferAttribute(nor, 3));return g;
    })();
    const birds = [], MAXB = 22, flock = new T.InstancedMesh(pigeonGeo, new T.MeshStandardMaterial({color: 0xffffff, roughness: .8}), MAXB);flock.castShadow = false;flock.count = 0;flock.name = 'Pigeons';flock.frustumCulled = false;group.add(flock);
    const shade = new T.Color();
    function addBirds(centre, n, spread, seed) {
      let r = seed;const rnd = () => {r = (r * 16807) % 2147483647;return r / 2147483647;};
      for (let k = 0; k < n && birds.length < MAXB; k++) {
        const a = rnd() * Math.PI * 2, d = rnd() * spread, x = centre.x + Math.cos(a) * d, z = centre.z + Math.sin(a) * d;
        const b = {home: {x, z}, x, z, y: groundAt(x, z), yaw: rnd() * 6.28, state: 'peck', t: rnd() * 3, vx: 0, vy: 0, vz: 0, back: 0};birds.push(b);
        shade.setRGB(.05, .055, .065).multiplyScalar(.8 + rnd() * .7);// the game's colours are linear: this is a pigeon greyflock.setColorAt(birds.length - 1, shade);
      }
      flock.count = birds.length;if (flock.instanceColor) flock.instanceColor.needsUpdate = true;
    }
    addBirds(spot(PEOPLE.kjell.place.a + 6, 2.6), 12, 3.2, 7);
    if (rolfAt) {const c = Math.cos(rolf.yaw || 0), sn = Math.sin(rolf.yaw || 0);addBirds({x: rolfAt.x - sn * 2.2 + c * .4, z: rolfAt.z - c * 2.2 - sn * .4}, 8, 1.6, 11);}
    function scare(from, dir, strength = 1) {
      for (const b of birds) {
        if (b.state === 'fly') continue;const dx = b.x - from.x, dz = b.z - from.z, d = Math.hypot(dx, dz);if (d > 16) continue;
        if (dir) {const L = Math.hypot(dir.x, dir.z) || 1, cos = (dx * dir.x + dz * dir.z) / (L * (d || 1));if (cos < .55) continue;}
        const s = (dir ? 7 : 3.5) * strength, ux = d ? dx / d : 0, uz = d ? dz / d : 1;
        b.state = 'fly';b.vx = (dir ? dir.x / (Math.hypot(dir.x, dir.z) || 1) * s : ux * s) + (Math.random() - .5);b.vz = (dir ? dir.z / (Math.hypot(dir.x, dir.z) || 1) * s : uz * s) + (Math.random() - .5);b.vy = 3 + Math.random() * 2;b.back = 7 + Math.random() * 6;
      }
      if (audio) audio.sfx('flap');
    }
    const m4 = new T.Matrix4(), q4 = new T.Quaternion(), e4 = new T.Euler(), v4 = new T.Vector3(), s4 = new T.Vector3(1, 1, 1);
    function birdsUpdate(dt, player) {
      for (let i = 0; i < birds.length; i++) {
        const b = birds[i];
        if (b.state === 'peck') {
          b.t -= dt;if (b.t < 0) {b.t = .5 + Math.random() * 2.5;const a = Math.random() * Math.PI * 2;b.tx = b.home.x + Math.cos(a) * 1.5;b.tz = b.home.z + Math.sin(a) * 1.5;}
          if (b.tx !== undefined) {const dx = b.tx - b.x, dz = b.tz - b.z, d = Math.hypot(dx, dz);if (d > .05) {const s = Math.min(d, .5 * dt);b.x += dx / d * s;b.z += dz / d * s;b.yaw = Math.atan2(-dx, -dz);}}
          b.y = groundAt(b.x, b.z);
          if (player && player.running && Math.hypot(player.x - b.x, player.z - b.z) < 2.2) scare(player, null, .7);
        } else {
          b.vy -= 1.2 * dt;b.x += b.vx * dt;b.y += b.vy * dt;b.z += b.vz * dt;b.yaw = Math.atan2(-b.vx, -b.vz);b.back -= dt;
          if (b.back < 0) {b.state = 'peck';b.x = b.home.x + (Math.random() - .5);b.z = b.home.z + (Math.random() - .5);b.y = groundAt(b.x, b.z);}
        }
        const flap = b.state === 'fly' ? Math.sin(performance.now() / 40 + i) * .25 : 0, bob = b.state === 'peck' ? Math.max(0, Math.sin(performance.now() / 160 + i * 1.7)) * .25 : 0;
        e4.set(bob, b.yaw, flap);q4.setFromEuler(e4);v4.set(b.x, b.y, b.z);m4.compose(v4, q4, s4);flock.setMatrixAt(i, m4);
      }
      flock.instanceMatrix.needsUpdate = true;
    }

    // ---- Empty bottles lying round Storgata (□ picks one up: +1 for the deposit). Not saved: there is always more litter. ----
    const bottleGeo = (() => {const a = new T.CylinderGeometry(.032, .034, .17, 10).toNonIndexed(), b = new T.CylinderGeometry(.012, .026, .07, 8).translate(0, .12, 0).toNonIndexed();const g = new T.BufferGeometry();g.setAttribute('position', new T.Float32BufferAttribute([...a.attributes.position.array, ...b.attributes.position.array], 3));g.setAttribute('normal', new T.Float32BufferAttribute([...a.attributes.normal.array, ...b.attributes.normal.array], 3));return g;})();
    let bottles = [];const bottleMesh = new T.InstancedMesh(bottleGeo, new T.MeshStandardMaterial({color: 0x3f7a4a, roughness: .15, metalness: .1, transparent: true, opacity: .85}), 16);bottleMesh.count = 0;bottleMesh.name = 'Empty bottles';group.add(bottleMesh);
    function placeBottles(list) {
      bottles = list.slice(0, 16).map((p, i) => ({...p, i, taken: false, lie: (i * 1.7) % 6.28}));bottleMesh.count = bottles.length;
      bottles.forEach(b => {e4.set(Math.PI / 2, b.lie, 0);q4.setFromEuler(e4);v4.set(b.x, b.y + .035, b.z);m4.compose(v4, q4, s4);bottleMesh.setMatrixAt(b.i, m4);});bottleMesh.instanceMatrix.needsUpdate = true;
    }
    function takeBottle(b) {b.taken = true;m4.makeScale(0, 0, 0);bottleMesh.setMatrixAt(b.i, m4);bottleMesh.instanceMatrix.needsUpdate = true;}

    // ---- Things to find (mushrooms, the harmonica), each shown only while its quest is on ----
    const finds = {};
    const capMat = {star: new T.MeshStandardMaterial({color: 0xfff1a8, emissive: 0xffd34d, emissiveIntensity: 1.3}), river: new T.MeshStandardMaterial({color: 0xa8e9ff, emissive: 0x3cc8ff, emissiveIntensity: 1.2}),
      bone: new T.MeshStandardMaterial({color: 0xf3ead6, emissive: 0xb9a37a, emissiveIntensity: .9}), moon: new T.MeshStandardMaterial({color: 0xe8e4ff, emissive: 0x9e94ff, emissiveIntensity: 1.4})};
    const sparkTex = (() => {const c = document.createElement('canvas');c.width = c.height = 64;const x = c.getContext('2d'), g = x.createRadialGradient(32, 32, 0, 32, 32, 32);g.addColorStop(0, 'rgba(255,255,255,1)');g.addColorStop(1, 'rgba(255,255,255,0)');x.fillStyle = g;x.fillRect(0, 0, 64, 64);const t = new T.CanvasTexture(c);t.colorSpace = T.SRGBColorSpace;return t;})();
    function placeFinds(where) {
      for (const p of PICKUPS) {
        const at = where[p.id];if (!at) continue;
        const g = new T.Group();g.position.set(at.x, at.y, at.z);g.visible = false;g.name = `Find ${p.id}`;group.add(g);
        if (p.kind === 'harmonica') {box(g, .1, .025, .03, mats.metal, 0, .015, 0);box(g, .1, .012, .032, mats.red, 0, .032, 0);}
        else {const m = capMat[p.kind], s = p.kind === 'bone' || p.kind === 'moon' ? 1.6 : 1;cyl(g, .025 * s, .035 * s, .12 * s, mats.white, 0, .06 * s, 0, 8);const c = mesh(g, new T.SphereGeometry(.08 * s, 14, 8, 0, Math.PI * 2, 0, Math.PI * .55), m, 0, .12 * s, 0);c.scale.y = .7;}
        g.traverse(o => {o.castShadow = false;});
        const halo = new T.Sprite(new T.SpriteMaterial({map: sparkTex, color: p.kind === 'harmonica' ? 0xfff2a0 : capMat[p.kind].emissive, transparent: true, depthWrite: false, blending: T.AdditiveBlending}));halo.scale.set(.6, .6, 1);halo.position.y = .38;g.add(halo);
        finds[p.id] = {p, g, halo, at};
      }
    }

    // ---- State, saved in the browser (or the account) ----
    let st = fresh();
    const load = () => {try {st = normalize(JSON.parse(localStorage.getItem(KEY) || 'null'));} catch {st = fresh();}};
    const save = () => {try {localStorage.setItem(KEY, JSON.stringify(st));} catch {}};
    load();

    // ---- Talking: the panel with the Norwegian lines, the English translation and the choices ----
    const panel = document.createElement('div');panel.id = 'talk';panel.hidden = true;root.append(panel);
    let conv = null;// {who, view: {name, about, lines, options}, sel, stick}
    const esc = s => String(s).replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));
    function render() {
      panel.hidden = !conv;if (!conv) return;const v = conv.view;
      const stars = conv.who === 'sigvald' ? `<span class="tk-trust">Trust ${'★'.repeat(trust(st))}${'☆'.repeat(Math.max(0, 5 - trust(st)))}</span>` : '';
      panel.innerHTML = `<div class="tk-head"><b>${esc(v.name)}</b><small>${esc(v.about.en)}</small>${stars}</div>` + v.lines.map(l => `<p><span class="no">${esc(l.no)}</span><span class="en">${esc(l.en)}</span></p>`).join('') +
        v.options.map((o, i) => `<div class="opt${i === conv.sel ? ' sel' : ''}"><span class="no">${o.act === 'bye' ? '○' : '✕'} ${esc(o.no)}</span><span class="en">${esc(o.en)}</span></div>`).join('') +
        '<small class="tk-keys">↑↓ choose · ✕ / Space answer · ○ / C leave</small>';
    }
    let api = null;
    function open(who, ctx) {
      const p = people[who];conv = {who, view: talk(st, who, {...ctx, seed: Math.floor(Math.random() * 1000)}), sel: 0, stick: false};
      if (p) {p.talkT = 6;p.av.say(conv.view.lines[conv.view.lines.length - 1].no);}
      if (audio) audio.sfx(who === 'sigvald' ? 'mystic' : 'hm');render();
    }
    function close() {if (conv) {st.met[conv.who] = 1;save();}conv = null;render();}
    // The game handles what an option does to the rest of the game (money, the bag, waypoints, powers) in onResult.
    function choose(ctx, onResult) {
      const opt = conv.view.options[conv.sel], who = conv.who;if (!opt) {close();return;}
      if (opt.act === 'bye') {perform(st, who, opt, ctx);close();return;}
      const r = perform(st, who, opt, ctx);save();if (onResult) onResult(r, who, opt);
      if (r.lines && r.lines.length) {conv.view = {...conv.view, lines: r.lines, options: [BYE]};conv.sel = 0;const p = people[who];if (p) {p.av.say(r.lines[0].no);p.talkT = 6;}render();} else close();
    }
    function input(inp, ctx, onResult) {
      const y = inp.move.y, n = conv.view.options.length;
      if (inp.pressed.has('up') || (y < -.5 && !conv.stick)) conv.sel = Math.max(0, conv.sel - 1);
      if (inp.pressed.has('down') || (y > .5 && !conv.stick)) conv.sel = Math.min(n - 1, conv.sel + 1);
      conv.stick = Math.abs(y) > .5;
      if (inp.pressed.has('cross')) choose(ctx, onResult);else if (inp.pressed.has('circle')) close();
      if (conv) render();
      inp.move.x = inp.move.y = 0;inp.look.x = inp.look.y = 0;['cross', 'circle', 'up', 'down', 'square', 'triangle', 'left', 'right', 'r1', 'cast'].forEach(b => inp.pressed.delete(b));
    }

    // ---- Each frame ----
    const camPos = new T.Vector3();
    function update(dt, player, camera) {
      camPos.copy(camera.position);
      const shopNear = people.kjell ? Math.hypot(camPos.x - people.kjell.at.x, camPos.z - people.kjell.at.z) < 170 : false;
      for (const p of Object.values(people)) {
        const near = p.id === 'rolf' ? rolfAt && Math.hypot(camPos.x - rolfAt.x, camPos.z - rolfAt.z) < 170 : shopNear;
        p.g.visible = !!near;if (!near) continue;
        // The head turns toward you when you come close, and back when you leave.
        const dx = player.x - p.at.x, dz = player.z - p.at.z, d = Math.hypot(dx, dz);let turn = 0;
        if (d < 7) {let a = Math.atan2(-dx, -dz) - p.yaw;a = Math.atan2(Math.sin(a), Math.cos(a));turn = Math.max(-1.1, Math.min(1.1, a));}
        p.head.rotation.y += (turn - p.head.rotation.y) * Math.min(1, dt * 4);
        p.talkT = Math.max(0, p.talkT - dt);p.head.rotation.x = p.talkT > 0 ? Math.sin(performance.now() / 180) * .06 : 0;
        if (p.wizard) {p.g.rotation.z = Math.sin(performance.now() / 900) * .035;p.g.rotation.x = Math.sin(performance.now() / 1300) * .02;}
        if (p.dog) {p.dog.t += dt;p.dog.tail.rotation.y = Math.sin(p.dog.t * (d < 4 ? 14 : 5)) * .6;p.dog.head.rotation.y = Math.max(-.8, Math.min(.8, turn * .8));}
        p.av.update(dt, camera, d < 25);
      }
      rolfGroup.visible = !!(rolfAt && Math.hypot(camPos.x - rolfAt.x, camPos.z - rolfAt.z) < 170);
      props.visible = bottleMesh.visible = crowd.visible = shopNear;flock.visible = shopNear || rolfGroup.visible;
      if (flock.visible) birdsUpdate(dt, player);
      for (const f of Object.values(finds)) {
        const on = status(st, f.p.quest) === 'active' && !st.got[f.p.id] && Math.hypot(camPos.x - f.at.x, camPos.z - f.at.z) < 150;
        f.g.visible = on;if (on) {f.g.rotation.y += dt * .8;f.halo.material.opacity = .55 + Math.sin(performance.now() / 300) * .25;}
      }
    }
    // □ prompts: talk to someone you look at (or stand next to), pick up a bottle, pick a mushroom / the harmonica.
    function prompt(player, look) {
      const u = look && look.userData;let who = u && u.storgata;
      if (!who) {let best = 1.7;for (const p of Object.values(people)) {if (!p.g.visible) continue;const d = Math.hypot(player.x - p.at.x, player.z - p.at.z);if (d < best && Math.abs(player.feet - p.at.y) < 1.5) {best = d;who = p.id;}}}
      if (who) {const P = PEOPLE[who], s = P.wizard ? '🍄 ' : '';return {text: `□ ${s}Talk to ${P.name} (${P.about.en})`, act: {talk: who}};}
      for (const f of Object.values(finds)) if (f.g.visible && Math.hypot(player.x - f.at.x, player.z - f.at.z) < 1.6 && Math.abs(player.feet - f.at.y) < 1.6) return {text: `□ Pick up ${f.p.name.en} (${f.p.name.no})`, act: {pick: f.p.id}};
      if (bottleMesh.visible) {let best = null, bd = 1.4;for (const b of bottles) {if (b.taken) continue;const d = Math.hypot(player.x - b.x, player.z - b.z);if (d < bd && Math.abs(player.feet - b.y) < 1.2) {bd = d;best = b;}}if (best) return {text: '□ Pick up the empty bottle (2 kr deposit)', act: {bottle: best}};}
      return null;
    }
    function poi() {
      const out = [];
      if (people.sigvald) {const k = world.toLocal(people.kjell.at.x, people.kjell.at.z), w = world.toLocal(people.sigvald.at.x, people.sigvald.at.z);out.push({x: k.x, s: k.s, color: '#c77d2e', label: 'Storgata regulars', glyph: '☺'}, {x: w.x, s: w.s, color: '#7b3fb5', label: 'Sopp-Sigvald (wizard)', glyph: '🍄'});}
      if (rolfAt && status(st, 'mona') === 'active') {const r = world.toLocal(rolfAt.x, rolfAt.z);out.push({x: r.x, s: r.s, color: '#c77d2e', label: 'Rolf', glyph: '✉'});}
      for (const f of Object.values(finds)) if (status(st, f.p.quest) === 'active' && !st.got[f.p.id]) {const l = world.toLocal(f.at.x, f.at.z);out.push({x: l.x, s: l.s, color: f.p.kind === 'harmonica' ? '#d4a017' : '#9b59b6', label: f.p.name.en, glyph: f.p.kind === 'harmonica' ? '♪' : '🍄'});}
      return out;
    }
    // Where a quest leads you next (world): the nearest thing still to find, Rolf, or back to the giver.
    function target(id, from) {
      const q = quest(id), s = status(st, id);if (s === 'ready') return people[q.who] && people[q.who].at;
      if (q.kind === 'deliver') return rolfAt;
      const left = pickupsOf(id).map(p => finds[p.id]).filter(f => f && !st.got[f.p.id]).sort((a, b) => Math.hypot(a.at.x - from.x, a.at.z - from.z) - Math.hypot(b.at.x - from.x, b.at.z - from.z));
      return left.length ? left[0].at : null;
    }
    api = {group, obstacles, hitboxes, people, finds, birds, scare, update, prompt, poi, target, open, close, input, render, save, takeBottle,
      get state() {return st;}, set state(v) {st = normalize(v);save();}, reload() {load();if (conv) close();}, get talking() {return !!conv;}, get conv() {return conv;},
      get trust() {return trust(st);}, get bottles() {return bottles;}, get rolfAt() {return rolfAt;},
      // Called by the game once the walk world exists: the finds and the bottles on walkable ground.
      place({pickups = {}, bottleSpots = []}) {placeFinds(pickups);placeBottles(bottleSpots);},
      quests: QUESTS, PEOPLE, PICKUPS, goal: (id, ctx) => goal(st, id, ctx), status: id => status(st, id), pick: id => {const r = pick(st, id);if (r) save();return r;}, photo: spot => {const r = photo(st, spot);if (r) save();return r;},
      along, outW};
    if (typeof window !== 'undefined' && window.addEventListener) window.addEventListener('haarklous-progress', () => api.reload());
    return api;
  }

  return {KEY, PEOPLE, REGULARS, QUESTS, PICKUPS, fresh, normalize, status, trust, lesson, pickupsOf, talk, perform, pick, photo, goal, ready, merge, MERGE, hasProgress, create};
});
