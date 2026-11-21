import { stopKinds } from './stop-kinds.mjs';
const string = { type: 'string' };
const number = { type: 'number' };
const boolean = { type: 'boolean' };
const array = (items) => ({ type: 'array', items });
const object = (properties, required = []) => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
});
const ll = array(number);
const strings = array(string);
const src = object({ url: string, title: string, checked: string });
const stay = object({
  area: string,
  why: string,
  examples: array(
    object({
      name: string,
      ll,
      priceNight: number,
      checked: string,
      src,
    }),
  ),
});
const transport = object({
  id: string,
  by: string,
  dir: string,
  carrier: string,
  code: string,
  from: string,
  to: string,
  dep: string,
  arr: string,
  price: number,
  bag: string,
  src,
  checked: string,
  recommended: boolean,
  why: string,
});
const period = { anyOf: [string, strings] };
const hours = object(
  Object.fromEntries(['default', '0', '1', '2', '3', '4', '5', '6'].map((key) => [key, period])),
);
const weekdays = object(
  Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((key) => [key, period])),
);
const stop = object({
  id: string,
  name: string,
  kind: { type: 'string', enum: stopKinds, description: 'English category ID. Use food for a restaurant, café, bakery, or food stop; market for a market visit. Use hotel for a booked hotel, transit for an arrival or departure terminal. Use nature or view for an outdoor attraction.' },
  query: string,
  aliases: strings,
  ll,
  start: { ...string, description: "Earliest planned local arrival time at this stop, HH:MM." },
  end: { ...string, description: "Planned local departure time after the visit, HH:MM." },
  cost: { ...number, description: "On-site spending in THB per person; exclude incoming transport." },
  mode: { type:'string', enum:['walk','red','car','van','own','transit'], description:'Mode of the incoming leg from the previous stop that day.' },
  legCost: { ...number, description: "Fare in THB per person for the incoming leg; -1 requests automatic pricing." },
  legMin: { ...number, description: "Estimated incoming travel duration in minutes, including a walking leg. For example 10 for a ten-minute walk to this stop." },
  minSrc: { ...string, description: "Use web only if the incoming travel duration in minutes comes from a real web source." },
  parking: { ...number, description: "Parking cost in THB per person on an own-car leg." },
  tolls: { ...number, description: "Tolls in THB per person on an own-car leg." },
  diet: { anyOf: [boolean, strings], description: 'True or a nonempty list of suitable dishes only when every stated food restriction is addressed at this meal. Use false or an empty list if suitability is unknown. A vegetarian dish alone does not establish allergen safety.' },
  note: string,
  meal: { type:'string', enum:['breakfast','lunch','dinner'], description:'Actual meal served here. Assign lunch or dinner to the meal stop at the relevant local time, including a market meal. A coffee break alone is not lunch.' },
  star: { ...string, description: "ID of the member whose requested wish this visit fulfills." },
  walk: { ...number, description: 'On-site walking distance in kilometres (km) per person during this visit only. Example: 250 metres inside a venue is 0.25. Never put minutes or distance walked between stops here. Use 0 for a seated café visit unless there is actual on-site walking; a ten-kilometre hike is 10.' },
  veg: { ...boolean, description: "True when this stop offers a suitable vegetarian meal. It does not verify other dietary requirements." },
  open: period,
  hours,
  days: object({ hours: weekdays, closed: strings, only: strings }),
  closedDays: array(number),
  closures: array({ anyOf: [string, object({ date: string, why: string }, ['date'])] }),
  outdoor: boolean,
  src,
  legSrc: src,
  catalogId: string,
  res: object({ done: boolean, todo: boolean, phone: string, name: string, note: string }),
  stayMin: { ...number, description: "Visit duration in minutes at this stop, excluding travel time." },
});
const day = object({ title: string, stops: array(stop) }, ['title', 'stops']);
const design = object(
  { days: array(day), summary: string, stay, arrivalSuggested: object({ by: string, why: string }) },
  ['days'],
);
const edit = object({
  op: string,
  id: string,
  day: number,
  after: string,
  afterId: string,
  stop,
  key: string,
  value: string,
  start: string,
  end: string,
  time: string,
});
const candidate = object({
  id: string,
  name: string,
  why: string,
  query: string,
  aliases: strings,
  tags: strings,
  price: string,
  ll,
  photoPage: string,
  checked: string,
  src,
});
const questions = object(
  {
    questions: array(object({ kind: string, title: string, options: array(candidate) }, ['kind', 'options'])),
  },
  ['questions'],
);
const dishes = array(
  object({
    name: string,
    why: string,
    description: string,
    price: { type: ['number', 'null'] },
    priceLocal: object({ amount: number, currency: string }),
    rate: number,
  }),
);
const research = object({
  summary: string,
  details: object({
    what: string,
    highlights: strings,
    price: string,
    hours: string,
    rating: string,
    booking: string,
    address: string,
  }),
  dishes,
  priceRange: string,
  hours: string,
  phone: string,
  tips: strings,
  rate: number,
  currency: string,
  confidence: string,
  sources: array(src),
  photoPage: string,
});
export const shapes = {
  design,
  daily: design,
  skeleton: object(
    {
      summary: string,
      stay,
      days: array(
        object({
          title: string,
          area: string,
          theme: string,
          places: strings,
          wishes: strings,
          meals: strings,
        }),
      ),
    },
    ['days'],
  ),
  repair: object({ edits: array(edit), summary: string }, ['edits']),
  replan: object(
    {
      summary: string,
      day: number,
      needs_vote: boolean,
      vote_reason: string,
      transport,
      options: array(
        object(
          {
            title: string,
            head: string,
            line: string,
            vote_reason: string,
            edits: array(edit),
            transport,
          },
          ['title', 'edits'],
        ),
      ),
    },
    ['options'],
  ),
  transport: object({ options: array(transport) }, ['options']),
  candidates: questions,
  research,
  pages: object({ pages: strings }, ['pages']),
};

// Keep the Claude grammar below the service's optional-field and union limits.
// Required scalar hints can use empty strings, arrays or the planner's defaults.
const requiredObject = (properties) => object(properties, Object.keys(properties));
const select = (schema, names) => Object.fromEntries(names.map((name) => [name, schema.properties[name]]));
const compactSource = requiredObject(src.properties);
const example = requiredObject({ name: string, ll, priceNight: number, src: compactSource });
const hotel = requiredObject({ area: string, why: string, examples: array(example) });
const optionalStop = {
  ...select(stop,['name','kind','query','ll','start','end','cost','veg','star','walk','legCost','note']),
  mode: { ...stop.properties.mode, enum: ['', ...stop.properties.mode.enum] },
  src: compactSource,
  meal: { ...stop.properties.meal, enum: ['', ...stop.properties.meal.enum] },
  diet: { ...strings, description: stop.properties.diet.description },
  open: string,
};
const compactStop = object(
  {
    ...optionalStop,
    id: string,
    aliases: strings,
    ...select(stop, ['legMin', 'minSrc', 'parking', 'tolls']),
    legSrc: compactSource,
    outdoor: boolean,
    days: requiredObject({
      only: strings,
      closed: strings,
      hours: requiredObject(
        Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((day) => [day, string])),
      ),
    }),
    closures: array(requiredObject({ date: string, why: string })),
    res: requiredObject({ todo: boolean, note: string, phone: string }),
    catalogId: string,
  },
  [...Object.keys(optionalStop).filter((key) => key !== 'src'), 'id', 'aliases', 'outdoor'],
);
const compactDesign = object(
  {
    summary: string,
    stay: hotel,
    arrivalSuggested: requiredObject({ by: string, why: string }),
    days: array(requiredObject({ title: string, stops: array(compactStop) })),
  },
  ['days', 'summary'],
);
const compactEdit = object(
  { op: string, id: string, day: number, after: string, stop: object(optionalStop) },
  ['op'],
);
const compactOption = requiredObject({
  title: string,
  head: string,
  line: string,
  vote_reason: string,
  edits: array(compactEdit),
});
const transitChange = requiredObject(
  select(transport, ['by', 'dir', 'code', 'carrier', 'from', 'to', 'dep', 'arr']),
);
export const claudeShapes = {
  ...shapes,
  design: compactDesign,
  daily: compactDesign,
  repair: requiredObject({ edits: array(compactEdit) }),
  replan: object(
    {
      summary: string,
      day: number,
      needs_vote: boolean,
      vote_reason: string,
      transport: transitChange,
      options: array(
        object({ ...compactOption.properties, transport: transitChange }, compactOption.required),
      ),
    },
    ['summary', 'day', 'needs_vote', 'options'],
  ),
  research: object(
    {
      ...research.properties,
      details: requiredObject(research.properties.details.properties),
      sources: array(compactSource),
      dishes: array(
        object(
          {
            name: string,
            why: string,
            price: { type: ['number', 'null'] },
            priceLocal: requiredObject({ amount: number, currency: string }),
          },
          ['name', 'price'],
        ),
      ),
    },
    ['summary', 'confidence', 'sources'],
  ),
};

// Responses schemas close every object and require its declared keys. A null
// value represents an unavailable fact or a field an edit should leave alone.
function responsesShape(raw, nullable = false) {
  let shape = { ...raw };
  if (raw.properties) {
    const fields = Object.entries(raw.properties);
    shape.properties = Object.fromEntries(
      fields.map(([key, value]) => [key, responsesShape(value, !raw.required.includes(key))]),
    );
    shape.required = fields.map(([key]) => key);
  }
  if (raw.items) shape.items = responsesShape(raw.items);
  if (raw.anyOf) shape.anyOf = raw.anyOf.map((branch) => responsesShape(branch));
  if (nullable) {
    if (shape.enum) shape.enum = [...shape.enum, null];
    if (shape.anyOf) shape.anyOf.push({ type: 'null' });
    else if (Array.isArray(shape.type)) shape.type = [...new Set([...shape.type, 'null'])];
    else if (['object', 'array'].includes(shape.type)) shape = { anyOf: [shape, { type: 'null' }] };
    else shape.type = [shape.type, 'null'];
  }
  return shape;
}
export const openaiShapes = Object.fromEntries(
  Object.entries(shapes).map(([operation, schema]) => [operation, responsesShape(schema)]),
);
