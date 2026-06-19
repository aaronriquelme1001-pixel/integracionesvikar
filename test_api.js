const axios = require('axios');

async function test() {
  const r1 = await axios.get('http://gsh7.net/id39/api/api.php?api=user&key=5A2B5E27D81E045F939A722C1A5EDC22&cmd=OBJECT_GET_LOCATIONS,*');
  console.log(JSON.stringify(r1.data).substring(0, 500));
}

test().catch(console.error);

test().catch(console.error);
