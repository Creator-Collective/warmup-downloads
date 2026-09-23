// Local comment writer. Captions, alt text and page text are untrusted data,
// never instructions. Replies come only from the fixed lists below plus the
// student's own sanitized search term; caption text is never copied.
(() => {
  'use strict';
  const GENERIC = Object.freeze([
    'this is so good', 'really enjoyed this one', 'love this so much', 'this made my day', 'okay this is great', 'such a good post',
    'so into this', "this is the kind of stuff i'm here for", 'love seeing this on my feed', 'glad this showed up for me', 'needed this today', 'this is really nice',
    'so here for this', 'love the energy here', 'big fan of this', "this one's great", 'keep these coming', 'more of this please',
    'this was a nice find', 'enjoyed this a lot', 'this is really well done', 'such good vibes', 'this is lovely', 'honestly love this',
    "can't get enough of this", 'this is a vibe', 'love this one', 'happy i found this', 'such a nice post', 'obsessed with this',
    'this is really cool', 'appreciate you posting this', 'this deserves more love', 'my favorite thing today', 'okay i love this', 'this just made my scroll better'
  ]);
  const TEMPLATES = Object.freeze([
    'always here for {t} content', 'more {t} content like this please', "{t} content like this is why i'm on here", 'love finding good {t} posts',
    'this is my kind of {t} post', '{t} posts like this make my day', 'good {t} content is hard to find, love this', 'i could scroll {t} stuff all day',
    '{t} posts always get me', 'here for all the {t} posts', 'really into {t} lately, this fits', '{t} done right'
  ]);
  const FAMILIES = Object.freeze({
    creator: ['creator stuff like this keeps me motivated', 'love seeing how other creators do it', 'this is so relatable as a creator', 'the creator grind is real', 'creator posts like this teach me so much', 'this makes me want to go film something', 'creating is so much harder than it looks', 'the creator community is the best', 'creator life in one post', 'this is the content i needed as a creator'],
    beauty: ['beauty posts are my happy place', 'okay this is so pretty', 'could scroll beauty stuff all day', 'this is giving me ideas', 'love a good beauty post', 'this is major inspo', 'so pretty, love it', 'beauty content always pulls me in', 'this is gorgeous', "the beauty content i'm here for"],
    fashion: ['love the style inspo', 'the style here is so good', 'okay i need to up my style game', 'this is giving me style ideas', 'such good taste', 'style posts are my weakness', 'this is so chic', 'obsessed with the styling', 'fashion content is the best part of my feed', "fashion inspo i didn't know i needed"],
    travel: ['travel content is my escape', 'the wanderlust is real right now', 'this is making me miss traveling', 'i need a trip after this', 'travel posts like this are the best', 'this is dreamy', 'places like this are why i love travel posts', 'love seeing travel stuff like this', 'this has me daydreaming', 'okay now i want to go somewhere'],
    finance: ['money talk like this is so needed', 'wish i learned money stuff earlier', 'love seeing people talk openly about money', 'budgeting is a whole journey', 'money posts keep me on track', 'this is the money content i need more of', 'talking about money should be normal', 'personal finance is such a learning curve', 'slowly getting better with money, posts like this help', 'money stuff feels less scary with posts like this'],
    tech: ['nerding out over this', 'love a good tech post', 'the tech side of my feed is the best side', 'okay this is neat', 'i could talk tech all day', 'tech posts are my comfort scroll', 'tech people get it', 'this scratches my tech brain', 'fun one for the tech crowd', 'tech content is my weakness'],
    parenting: ['parenting is no joke', 'the parent life is so real', 'this is so wholesome', 'love seeing real parenting content', 'sending love to all the parents', 'this is so sweet', 'parents deserve all the credit', 'family content like this warms my heart', 'every parent can relate to this', 'parenting posts always get me in the feels'],
    pets: ['pet content always makes my day', 'animals make everything better', "my heart can't take this", 'the cuteness is too much', 'pets are the best part of the internet', 'this made me smile so much', 'needed this pet content today', 'so much love for this', 'pet posts are my favorite posts', 'this is pure joy'],
    lifestyle: ['lifestyle posts are my comfort content', 'this is so calming', 'love this little slice of life', 'such a mood', 'this is the kind of inspo i needed', 'this makes me want to reset my week', 'such a peaceful post', 'the vibes here are unmatched', 'life goals honestly', 'lifestyle content like this is the best'],
    business: ['love supporting small businesses', 'the small business grind is real', 'entrepreneur life is no joke', 'rooting for you', 'so inspiring for anyone building something', 'building something is so hard, love this', 'small business content always gets me', 'love seeing the work behind a business', 'cheering you on', 'the hustle is real'],
    mindset: ['needed this reminder', 'this is such a good reminder', 'mindset stuff like this hits', 'this is the push i needed', 'such a good thing to sit with', 'growth is a process', 'one day at a time', 'this is a good mental reset', 'felt this', 'love this mindset'],
    fitness: ['this is so motivating', 'gym content keeps me going', 'okay i need to get moving now', 'fitness posts are my motivation', 'this is my push to get to the gym', 'love seeing fitness stuff like this', 'consistency is everything', 'respect the grind', 'this makes me want to train', 'the dedication is inspiring'],
    food: ["okay now i'm hungry", "now i'm craving something", "food content is dangerous when i'm hungry", 'my stomach is growling', 'this looks so good', 'food posts are my weakness', 'yum', "chef's kiss", 'this is making me want to cook', 'the foodie in me is happy'],
    study: ['study content keeps me going', 'needed this study motivation', 'student life is so real', 'this makes me want to open my notes', 'study posts are weirdly motivating', 'sending good vibes to everyone studying', 'the student struggle is real', 'love a good study post', 'okay time to study', 'this is my sign to get some work done']
  });
  const FAMILY_ORDER = ['pets', 'parenting', 'food', 'fitness', 'beauty', 'fashion', 'travel', 'finance', 'study', 'business', 'tech', 'creator', 'mindset', 'lifestyle'];
  const FAMILY_KEYWORDS = Object.freeze({
    pets: ['dog', 'dogs', 'puppy', 'pup', 'cat', 'cats', 'kitten', 'pet', 'pets'],
    parenting: ['mom', 'mum', 'dad', 'parenting', 'parent', 'baby', 'toddler', 'kids', 'child', 'children', 'motherhood', 'fatherhood', 'family'],
    food: ['food', 'recipe', 'cooking', 'baking', 'meal', 'foodie', 'dinner', 'dessert', 'vegan'],
    fitness: ['fitness', 'gym', 'workout', 'training', 'running', 'yoga', 'pilates', 'lifting', 'exercise', 'crossfit', 'calisthenics'],
    beauty: ['skincare', 'makeup', 'beauty', 'hair', 'nails', 'skin', 'lashes', 'cosmetics'],
    fashion: ['fashion', 'outfit', 'ootd', 'style', 'streetwear', 'thrift', 'wardrobe', 'clothes', 'shopping'],
    travel: ['travel', 'trip', 'vacation', 'backpacking', 'wanderlust'],
    finance: ['money', 'finance', 'investing', 'budget', 'budgeting', 'saving', 'savings', 'stocks', 'debt', 'financial', 'frugal'],
    study: ['study', 'studying', 'student', 'exam', 'college', 'university', 'school', 'studygram'],
    business: ['business', 'entrepreneur', 'hustle', 'shop', 'etsy', 'startup', 'founder', 'ecommerce', 'handmade'],
    tech: ['tech', 'gadget', 'coding', 'programming', 'developer', 'ai', 'iphone', 'android', 'software', 'apps', 'app'],
    creator: ['ugc', 'creator', 'content', 'brand', 'branding', 'influencer', 'reels', 'storytelling', 'editing', 'youtube', 'marketing'],
    mindset: ['mindset', 'motivation', 'improvement', 'productivity', 'habits', 'discipline', 'growth', 'confidence', 'journaling', 'self'],
    lifestyle: ['lifestyle', 'vlog', 'routine', 'aesthetic', 'home', 'cozy', 'selfcare', 'wellness', 'life']
  });
  const SHAPES = Object.freeze({
    tips: ['these tips are so helpful', 'love a good list like this', 'this is a really handy list', 'this is so useful', 'short and useful, love it', 'such practical advice'],
    tutorial: ['this is so easy to understand', 'love a clear tutorial', "love when it's broken down like this", 'needed it explained like this', 'super clear, love it', 'such a helpful walkthrough'],
    recipe: ['this recipe sounds so good', 'love a recipe like this', 'recipes like this are the best', 'this recipe sounds so comforting', 'okay this recipe has me hungry', 'always here for a good recipe'],
    outfit: ['this outfit is so good', 'the fit is everything', 'love this fit', 'outfit inspo right here', 'okay the styling on this', 'obsessed with this outfit'],
    progress: ['love seeing the progress', 'the progress is amazing', 'this journey is so inspiring', 'keep going, this is amazing', 'progress posts are the best', 'so fun seeing how far this has come'],
    day: ['love a good day in the life', 'routines like this are so satisfying', 'this is such a nice routine', 'always curious how people spend their day', 'day in the life posts are my favorite', 'this routine is goals'],
    setup: ['this setup is goals', 'love a good setup post', 'setup posts are so satisfying', 'love seeing how people set things up'],
    haul: ['hauls are my weakness', 'love a good haul', 'this haul is so fun', 'now i want to go shopping'],
    question: ['love this question', 'curious what everyone says', 'such a good question', 'so many answers to this one', 'thinking about this now', 'fun one to think about']
  });
  // Kept from 0.6.55, minus the four replies that repeated a caption amount and three that assumed the post was a video.
  const TOPICS = Object.freeze({
    disclaimer: ['the disclaimer lol', 'had to get that disclaimer in', 'there it is, not financial advice', 'that disclaimer is doing a lot of work'],
    practice: ['the every day part is where it gets hard 😭', 'daily practice sounds easy until you miss a day', 'a little practice is way less intimidating', 'the daily part takes some getting used to', 'how much practice do you do each day?', 'even a few minutes of practice counts', 'starting small every day makes sense', 'a little practice feels doable'],
    process: ['the behind the scenes is my favorite part', 'love a good process breakdown', 'more of the actual process please', 'always curious about the process'],
    brand: ['the personal part gets lost so easily', 'finding your own style takes a minute', 'easy to overthink the personal brand stuff', 'figuring out how to sound like yourself is weirdly hard'],
    study: ['getting started is the hardest part of studying', 'the study routine takes some getting used to', 'studying takes so much trial and error', 'how long are your study sessions?'],
    story: ['figuring out where to start the story is tricky', 'the story is what keeps me watching', 'a good story makes such a difference', 'cutting parts of the story is the hard part'],
    editing: ['the editing side is so underrated', 'editing is where it all comes together', 'always curious how people edit', 'what do you edit on?'],
    rates: ['pricing is such a guessing game at first', 'the rates part is always awkward', 'figuring out what to charge takes a minute', 'how did you pick your starting rate?'],
    cooking: ['how long does this take to make?', 'would this keep in the fridge?', 'curious what goes into the prep', 'curious how this turns out the next day'],
    workout: ['how long is the whole workout?', 'getting started is half the workout', 'finding a workout routine that sticks takes a while', 'how often do you do this routine?'],
    posting: ['coming up with ideas every day is the hard part', 'posting every day takes so much planning', 'do you make a few posts at once?', 'some days the ideas just disappear']
  });

  const MAX_TEXT = 6000;
  const SUFFIXES = ['', 's', 'es', 'ing', 'ed', 'er', 'ers'];
  const NEGATION = /\b(?:not|no|never|without|don't|dont|doesn't|didn't|isn't|aren't|wasn't|weren't|can't|couldn't|cannot|won't|wouldn't|shouldn't|nobody|nothing|none)\b/u;
  const INJECTION = [/\bignore (?:all |any |the )?(?:previous |prior |above )?(?:instructions|prompts|messages)\b/iu, /\bsystem prompt\b/iu, /\byou are (?:a |an )?(?:ai|assistant|chatgpt|language model|bot)\b/iu, /\bas an ai\b/iu, /\bdeveloper mode\b/iu, /\bpassword\b/iu];
  const BAIT = [
    /\b(?:comment|type|reply|dm|message|drop)\s+(?:me\s+)?["']?[\p{L}\p{N}]+["']?\s+(?:below|for|to get|to receive|and i'?ll|and i will|if you)\b/iu,
    /\b[Cc][Oo][Mm][Mm][Ee][Nn][Tt]\s+(?:"[^"]{1,24}"|'[^']{1,24}'|[\p{Lu}\p{N}]{2,}\b)/u,
    /\b(?:i'?ll|i will|we'?ll|we will)\s+(?:send|dm|message)\s+(?:you|it)\b/iu,
    /\blink in (?:my |the )?bio\b/iu, /\b(?:giveaway|enter to win|contest)\b/iu, /\bdm me\b/iu, /\bfollow (?:me|for|us)\b/iu,
    /\btag (?:a |your |two |three |\d+ )?(?:friends?|bestie|bff|someone|person|partner|mom|dad|sister|brother)\b/iu,
    /\b(?:promo|discount) code\b|\buse (?:my )?code\b/iu,
    /\bcomment (?:below|the word)\b/iu,
    /\b(?:drop|leave|type|write) (?:a |an |your )?(?:[\p{L}\p{N}]+ ){0,2}(?:below|in the comments)\b/iu
  ];
  const SENSITIVE = /\b(?:rip|r\.i\.p|rest in peace|passed away|passing of|funeral|condolences|grief|grieving|in (?:loving )?memory|memorial|miscarriage|stillbirth|cancer|chemo(?:therapy)?|diagnos\w*|hospice|hospital\w*|surgery|icu|suicid\w*|self[ -]harm|depress\w*|abuse\w*|assault\w*|trauma\w*|tragedy|tragic|war|shooting|laid off|layoffs?|divorce\w*|closing (?:down|our doors|up shop)|shutting down|(?:going )?out of business|last day (?:open|of business)|ceasing operations|burn(?:ed|t)? ?out|lost (?:my|our) (?:mom|mum|mother|dad|father|grandma|grandpa|grandmother|grandfather|nan|baby|son|daughter|brother|sister|husband|wife|partner|friend|best friend|dog|cat|pet|job)|loss of (?:my|our) \p{L}+|loss of a (?:loved one|child|baby|pet|parent|friend))\b/iu;
  const TONE = /\b(?:hate|hated|hating|worst|scam\w*|awful|disgusting|furious|angry|rant\w*|unpopular opinion|hot take|stop doing|red flags?|toxic|cringe\w*)\b/iu;
  const BLOCKED_REPLY = /[@#<>"“”]|https?:|www\.|\.(?:com|net|org|io|co|ly|me)\b|[–—]|\b(?:follow|dm|link|bio|subscribe|giveaway|click|tap|visit|buy|comment|code|promo|discount|check out|my page|my profile)\b/iu;
  const FORMAT_WORDS = new Set(['content', 'ideas', 'idea', 'inspo', 'inspiration', 'tips', 'tip', 'posts', 'post', 'reels', 'reel', 'videos', 'video', 'guide', 'guides', 'tutorial', 'tutorials', 'hacks', 'hack', 'advice']);
  const LEADING_BLOCK = new Set(['how', 'what', 'why', 'when', 'where', 'who', 'which', 'best', 'top', 'my', 'your', 'the', 'a', 'an', 'for', 'to', 'free', 'is', 'are', 'do', 'does', 'can', 'should']);
  const BLOCKED_TERM_WORDS = new Set(['comment', 'comments', 'dm', 'dms', 'link', 'bio', 'follow', 'follows', 'follower', 'followers', 'tag', 'giveaway', 'free', 'sale', 'promo', 'code', 'discount', 'collab', 'shop', 'buy', 'subscribe', 'sex', 'nsfw', 'onlyfans', 'porn', 'nude', 'crypto', 'forex', 'casino', 'betting', 'loan', 'loans']);
  const FOOD = /\b(?:pasta|cake|bread|chicken|rice|soup|cookies|flour|butter|oven|sauce|salad|dinner|breakfast|lunch|dessert|smoothie|meal|protein|oats|eggs|tofu|beef|salmon|curry|noodles|pizza|brownies|muffins)\b/u;
  const WEIGHTS = Object.freeze({ topic: 8, shape: 6, family: 4, template: 1, generic: 1 });
  const TIER_ORDER = ['topic', 'shape', 'family', 'template', 'generic'];
  const FALLBACK_ORDER = ['topic', 'shape', 'family', 'generic', 'template'];

  const fold = value => value.normalize('NFKC').replace(/[\u200B-\u200D\u2060\uFEFF\u00AD]/g, '').replace(/[’‘`´ʼ]/g, "'").replace(/[“”]/g, '"');
  const normalize = value => fold(value).toLocaleLowerCase().replace(/[^\p{L}\p{N}#]+/gu, ' ').trim();
  function commentKey(value) {
    return fold(String(value)).toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  }
  function fnv1a(text) {
    let hash = 0x811c9dc5;
    for (const character of text) { hash ^= character.codePointAt(0); hash = Math.imul(hash, 0x01000193) >>> 0; }
    return hash >>> 0;
  }
  function wordMatches(word, w) {
    if (SUFFIXES.some(suffix => word === w + suffix)) return true;
    if (w.endsWith('e') && (word === `${w.slice(0, -1)}ing` || word === `${w.slice(0, -1)}ed`)) return true;
    if (w.endsWith('y') && w.length > 3 && (word === `${w.slice(0, -1)}ies` || word === `${w.slice(0, -1)}ied`)) return true;
    if (w.endsWith('ies') && w.length > 4 && word === `${w.slice(0, -3)}y`) return true;
    return w.length > 3 && w.endsWith('s') && word === w.slice(0, -1);
  }
  function termMatches(text, term) {
    const normalized = normalize(text);
    const words = normalized.replace(/#/g, ' ').split(/\s+/).filter(Boolean);
    const tags = (fold(text).toLocaleLowerCase().match(/#[\p{L}\p{N}_]+/gu) || []).map(tag => tag.slice(1).replace(/_/g, ''));
    const termWords = normalize(term).replace(/#/g, ' ').split(/\s+/).filter(Boolean);
    if (!termWords.length) return false;
    if (termWords.every(w => words.some(word => wordMatches(word, w)))) return true;
    const joined = termWords.join('');
    return tags.some(tag => SUFFIXES.some(suffix => tag === joined + suffix) || (joined.length >= 4 && (tag.startsWith(joined) || tag.endsWith(joined))));
  }
  function looseNicheMatch(text, terms) {
    return typeof text === 'string' && text.length <= MAX_TEXT && Array.isArray(terms) && terms.some(term => typeof term === 'string' && termMatches(text, term));
  }
  function matchedTerm(text, terms) {
    if (typeof text !== 'string' || text.length > MAX_TEXT * 2 + 1 || !Array.isArray(terms)) return null;
    return terms.find(term => typeof term === 'string' && termMatches(text, term)) || null;
  }
  function classifyFamily(term) {
    if (typeof term !== 'string') return null;
    const words = normalize(term).replace(/#/g, ' ').split(/\s+/).filter(Boolean);
    return FAMILY_ORDER.find(family => FAMILY_KEYWORDS[family].some(keyword =>
      words.some(word => wordMatches(word, keyword) || (keyword.length >= 4 && word.startsWith(keyword))))) || null;
  }
  function insertableTerm(term) {
    if (typeof term !== 'string') return null;
    let words = term.normalize('NFKC').toLocaleLowerCase().replace(/[#@]/g, '').trim().split(/\s+/).filter(Boolean);
    while (words.length && FORMAT_WORDS.has(words[words.length - 1])) words = words.slice(0, -1);
    const value = words.join(' ');
    if (!words.length || words.length > 3 || value.length < 3 || value.length > 24 || !/^[a-z0-9]+(?: [a-z0-9]+){0,2}$/.test(value)) return null;
    if (LEADING_BLOCK.has(words[0]) || words.some(word => BLOCKED_TERM_WORDS.has(word) || /^\d+$/.test(word))) return null;
    return value;
  }
  function shingles(text) {
    const words = commentKey(text).split(' ').filter(Boolean);
    const result = new Set();
    for (let index = 0; index + 4 <= words.length; index++) result.add(words.slice(index, index + 4).join(' '));
    return result;
  }
  function safeReply(reply, context = '') {
    if (typeof reply !== 'string' || reply !== reply.toLocaleLowerCase() || reply.trim() !== reply || reply.length < 2 || reply.length > 80 || reply.split(/\s+/).length > 12) return false;
    if (BLOCKED_REPLY.test(reply)) return false;
    const captionShingles = shingles(typeof context === 'string' ? context : '');
    return ![...shingles(reply)].some(shingle => captionShingles.has(shingle));
  }
  function splitSentences(caption) {
    return caption.split(/(?<=[.!?])\s+|\n+/u).map(text => text.replace(/(?:\s+#[\p{L}\p{N}_]+)+\s*$/u, '').trim()).filter(Boolean);
  }
  function safeSentence(text) {
    const words = text.split(/\s+/);
    return words.length >= 4 && words.length <= 24 && text.length <= 180 &&
      !/[:;]$|^[→•]/u.test(text) && !/^(?:please\s+)?(?:save|share|like|send|click|tap|check out|visit|download|buy|join|sign up|watch|read)\b/iu.test(text) && !/[?@#<>]|https?:|www\.|["]/iu.test(text) &&
      !/\b(comment|reply|dm|tag|follow|subscribe|giveaway|link in bio|ignore|instructions|prompt|system|assistant)\b/iu.test(text);
  }
  function topicPool(sentences, terms) {
    const candidates = sentences.filter(safeSentence).sort((a, b) => Number(looseNicheMatch(b, terms)) - Number(looseNicheMatch(a, terms)));
    const pools = [];
    for (const sentence of candidates) {
      const detail = sentence.toLocaleLowerCase();
      if ((detail.match(/\$\d[\d,]*(?:\.\d+)?\s*(?:million|billion|[mkb]\b)?/gu) || []).length > 1) continue;
      if (/\b(?:not|no) financial advice\b/u.test(detail)) pools.push(TOPICS.disclaimer);
      else if (NEGATION.test(detail)) continue;
      else if (/\b(?:practice|practicing|practise|practising)\b/u.test(detail) && /\b(?:every day|daily|a little)\b/u.test(detail)) pools.push(TOPICS.practice);
      else if (/\b(?:sharing|showing|share|show) (?:your|the|my|our) process\b/u.test(detail)) pools.push(TOPICS.process);
      else if (/\b(?:personal branding|personal brand)\b/u.test(detail)) pools.push(TOPICS.brand);
      else if (/\b(?:study tips|studying|study habits)\b/u.test(detail)) pools.push(TOPICS.study);
      else if (/\b(?:storytelling|telling stories|tell a story)\b/u.test(detail)) pools.push(TOPICS.story);
      else if (/\b(?:editing|video edits|video editing)\b/u.test(detail)) pools.push(TOPICS.editing);
      else if (/\b(?:ugc rates|pricing|setting (?:your |my )?rates)\b/u.test(detail)) pools.push(TOPICS.rates);
      else if (/\b(?:cooking|baking)\b/u.test(detail) || (/\b(?:recipe|ingredients)\b/u.test(detail) && /\b(?:pasta|cake|bread|chicken|rice|soup|cookies|flour|butter|oven|sauce)\b/u.test(detail))) pools.push(TOPICS.cooking);
      else if (/\b(?:workout|training routine|gym routine)\b/u.test(detail)) pools.push(TOPICS.workout);
      else if (/\b(?:posting consistently|consistent posting|post every day|posting every day)\b/u.test(detail)) pools.push(TOPICS.posting);
    }
    return pools;
  }
  function detectShape(sentences) {
    const plain = sentences.map(text => text.toLocaleLowerCase()).filter(text => !NEGATION.test(text));
    const any = pattern => plain.some(text => pattern.test(text));
    if (plain.some(text => /\b(?:recipes?|ingredients)\b/u.test(text) && FOOD.test(text))) return 'recipe';
    if (any(/\b(?:outfits?|ootd|fit check|outfit of the day|what i wore|lookbook)\b/u)) return 'outfit';
    if (any(/\b(?:before and after|progress|transformation|glow[ -]?up)\b|\b(?:day|week|month)\s+\d{1,3}\b/u)) return 'progress';
    if (plain.some(text => /\b(?:how to|tutorial|step by step|here'?s how|walkthrough)\b/u.test(text) && !text.endsWith('?'))) return 'tutorial';
    if (any(/\b(?:tips?|ways to|mistakes|lessons|hacks?|things i wish)\b/u) || any(/^\s*\d+[.)]\s/u)) return 'tips';
    if (any(/\b(?:day in (?:my|the) life|dimil|ditl|(?:morning|night|evening) routine|routine|vlog)\b/u)) return 'day';
    if (any(/\b(?:desk setup|setup|workspace)\b/u)) return 'setup';
    if (any(/\bhauls?\b/u)) return 'haul';
    const ends = sentences.length ? [sentences[0], sentences[sentences.length - 1]].map(text => text.toLocaleLowerCase()) : [];
    if (ends.some(text => text.endsWith('?') && !NEGATION.test(text) && text.split(/\s+/).length <= 20)) return 'question';
    return null;
  }
  function writeComment({ caption, text, terms, used, postId, salt } = {}) {
    const cleanCaption = caption == null ? '' : caption;
    const cleanText = text == null ? '' : text;
    if (typeof cleanCaption !== 'string' || typeof cleanText !== 'string' || cleanCaption.length > MAX_TEXT || cleanText.length > MAX_TEXT ||
        !Array.isArray(terms) || !terms.length || !terms.every(term => typeof term === 'string')) return { text: null, reason: 'invalid' };
    const whole = fold(`${cleanCaption}\n${cleanText}`);
    if (INJECTION.some(pattern => pattern.test(whole))) return { text: null, reason: 'suspicious' };
    if (BAIT.some(pattern => pattern.test(whole))) return { text: null, reason: 'bait' };
    if (SENSITIVE.test(whole) || TONE.test(whole)) return { text: null, reason: 'sensitive' };
    const term = matchedTerm(`${cleanCaption} ${cleanText}`, terms);
    if (!term) return { text: null, reason: 'off-niche' };
    const usedKeys = new Set([...(used instanceof Set || Array.isArray(used) ? used : [])].filter(value => typeof value === 'string')
      .map(value => value.startsWith('template:') ? value : commentKey(value)));
    const sentences = splitSentences(fold(cleanCaption));
    const context = `${cleanCaption} ${cleanText}`;
    const fresh = item => !usedKeys.has(commentKey(item.text)) && !(item.templateKey && usedKeys.has(item.templateKey));
    const tiers = new Map();
    const topic = topicPool(sentences, terms).find(pool => pool.some(reply => !usedKeys.has(commentKey(reply))));
    if (topic) tiers.set('topic', topic.map(reply => ({ text: reply })));
    const shape = detectShape(sentences);
    if (shape) tiers.set('shape', SHAPES[shape].map(reply => ({ text: reply })));
    const family = classifyFamily(term);
    if (family) tiers.set('family', FAMILIES[family].map(reply => ({ text: reply })));
    const inserted = insertableTerm(term);
    const templateUses = [...usedKeys].filter(key => key.startsWith('template:')).length;
    const nonTemplate = usedKeys.size - templateUses * 2;
    if (inserted && templateUses * 3 <= nonTemplate) {
      const hasContent = inserted.split(' ').includes('content');
      tiers.set('template', TEMPLATES.flatMap((template, index) => hasContent && template.includes('{t} content') ? [] :
        [{ text: template.replace('{t}', inserted), templateKey: `template:${index + 1}` }]));
    }
    tiers.set('generic', GENERIC.map(reply => ({ text: reply })));
    // salt is per session, so different students (or the same student another day) get different wording on the same post.
    const seed = `${postId == null ? '' : String(postId)}\n${cleanCaption}`;
    const hash = fnv1a(typeof salt === 'string' && salt ? `${salt.slice(0, 64)}\n${seed}` : seed);
    const available = TIER_ORDER.filter(name => tiers.has(name) && tiers.get(name).some(fresh));
    if (!available.length) return { text: null, reason: 'exhausted' };
    let point = hash % available.reduce((sum, name) => sum + WEIGHTS[name], 0);
    const start = available.find(name => (point -= WEIGHTS[name]) < 0);
    for (const name of [start, ...FALLBACK_ORDER.filter(name => name !== start && available.includes(name))]) {
      const list = tiers.get(name).filter(fresh);
      const offset = (hash >>> 8) % list.length;
      for (let index = 0; index < list.length; index++) {
        const item = list[(offset + index) % list.length];
        if (safeReply(item.text, context)) return { text: item.text, source: name, templateKey: item.templateKey || null };
      }
    }
    return { text: null, reason: 'exhausted' };
  }
  for (const group of [FAMILIES, FAMILY_KEYWORDS, SHAPES, TOPICS]) for (const list of Object.values(group)) Object.freeze(list);
  const pools = Object.freeze({ generic: GENERIC, templates: TEMPLATES, families: FAMILIES, shapes: SHAPES, topics: TOPICS });
  globalThis.commentWriter = Object.freeze({ writeComment, looseNicheMatch, matchedTerm, commentKey, classifyFamily, detectShape, insertableTerm, safeReply, pools });
  if (typeof module !== 'undefined' && module.exports) module.exports = globalThis.commentWriter;
})();
