/**
 * Stage ids are three short, easy-to-say English words ("apple-banana-orange").
 * 512 words → 134M combinations; collisions are retried by the creator.
 */
export const WORDS = `
acorn album amber anchor angel ant apple apron arch arrow atlas attic aunt autumn avocado
badge bagel baker balloon bamboo banana band banjo barn basket bat beach beacon bean bear beaver
bed bee beetle bell bench berry bicycle bird biscuit blanket blossom blue boat bone book boot
bottle bowl box branch bread breeze brick bridge brook broom brush bubble bucket bud buffalo
bull bunny butter button cabin cable cactus cake camel camera camp candle candy canoe canyon
cap captain car card carpet carrot castle cat cave cedar cello chair chalk cheese cherry chess
chicken chimney cider cinema circle city clam cliff clock cloud clover coast cocoa coconut coffee
comet compass cookie copper coral cotton cougar cow crab crane crayon cream creek cricket crow
crown cub cup curtain cushion daisy dancer deer desert desk diamond dinner dolphin donkey door
dove dragon drum duck dune eagle earth echo eel egg elbow elephant elk ember engine fabric
falcon farm feather fern ferry fiddle field fig finch fire fish flag flame flute fog forest
fork fossil fountain fox frog frost fruit galaxy garden garlic gate gem giraffe glacier glass
globe glove goat gold goose grape grass guitar gull hammer harbor harp hat hawk hazel heart
hedge helmet hen heron hill hippo honey hoop horizon horse hotel house iceberg igloo island ivory
ivy jacket jade jaguar jam jar jelly jewel juice jungle kayak kettle key kite kitten kiwi koala
ladder lake lamp lantern lark lava lawn leaf lemon lens leopard letter library lily lime lion
lizard llama lobster lotus lunar lynx magnet mango maple marble market meadow melon mesa milk
mint mirror mitten mole monkey moon moose moss moth mountain mouse muffin mule museum mushroom
music nest net noodle north nut oak oasis ocean octopus olive onion opal orange orbit orchard
orchid otter owl oyster paddle paint palm panda paper parade parrot pasta peach peacock peanut
pear pearl pebble pecan pelican pen pencil penguin pepper piano pickle pigeon pillow pine pizza
planet plum pocket pond pony poppy potato prism pudding puffin pumpkin puppy quail quartz quill
rabbit raccoon radio rain rainbow raven reef ribbon rice ridge river robin rocket rose ruby
saddle sail salmon salt sand satellite scarf school seal seed shadow shark sheep shell ship shoe
silver skate sky sled sloth snail snow soap sock sofa spark spider spoon spring squid squirrel
star stone storm straw stream sugar summer sun swan sweater table taco tea teapot tiger toast
tomato topaz torch tower toy tractor train tree trout trumpet tulip tuna turkey turtle umbrella
valley vase velvet violet violin volcano wagon walnut walrus wave whale wheat wheel whistle
willow wind window winter wolf wombat wood wool yacht yak yarn yogurt zebra zinnia zucchini
acrobat almond basil beetroot blizzard bonsai cabbage canary cashew chestnut cobalt condor
cupcake cypress dahlia ferret flamingo gazelle ginger gopher hamster hazelnut hummingbird iris
jasmine kiln lagoon lemur lilac magpie mammoth marmot meteor narwhal nebula nutmeg orca papaya
parsley peony plover poodle quince radish rhino saffron sapphire sequoia sesame sparrow spruce
starling sunflower tadpole thistle tofu toucan truffle tundra vanilla waffle wasabi yeti
`
  .trim()
  .split(/\s+/);

export const STAGE_ID_RE = /^[a-z]+-[a-z]+-[a-z]+$/;

export function isStageId(value: unknown): value is string {
  return typeof value === "string" && value.length <= 64 && STAGE_ID_RE.test(value);
}

function randomIndex(max: number): number {
  const buf = new Uint32Array(1);
  // Rejection sampling keeps the distribution uniform.
  const limit = Math.floor(0x1_0000_0000 / max) * max;
  for (;;) {
    crypto.getRandomValues(buf);
    const n = buf[0] ?? 0;
    if (n < limit) return n % max;
  }
}

/** Three distinct words joined by "-". */
export function generateStageId(pick: (max: number) => number = randomIndex): string {
  const chosen: string[] = [];
  while (chosen.length < 3) {
    const word = WORDS[pick(WORDS.length)];
    if (word && !chosen.includes(word)) chosen.push(word);
  }
  return chosen.join("-");
}
