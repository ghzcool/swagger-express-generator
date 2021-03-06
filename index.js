const fs = require('fs');
const Mustache = require('mustache');

console.log('Generate Swagger React client API');

const args = {
  input: './swagger.json',
  output: './output',
  template: 'es6',
  format: 'js'
};

// TODO: update only things with comment // generated - remove this comment if file should not be automatically updated

for (let i = 0; i < process.argv.length; i++) {
  const item = process.argv[i];
  switch (item) {
    case "-I":
      args.input = process.argv[++i];
      break;
    case "-O":
      args.output = process.argv[++i];
      break;
    case "-T":
      args.template = process.argv[++i];
      break;
    case "-F":
      args.format = process.argv[++i];
      break;
    default:
  }
}

const templatePath = args.customTemplate || __dirname + `/templates/${args.template}`;

const data = fs.readFileSync(args.input, { encoding: 'utf8', flag: 'r' });
const controllerTemplate = fs.readFileSync(templatePath + '/controller.mustache', { encoding: 'utf8', flag: 'r' });
const modelTemplate = fs.readFileSync(templatePath + '/model.mustache', { encoding: 'utf8', flag: 'r' });

let parsed;
try {
  parsed = JSON.parse(data);
} catch (e) {
  console.error(e);
  return;
}

const info = parsed.info || {};
const paths = parsed.paths || {};
const components = parsed.components || {};
const schemas = components.schemas || {};
const definitions = parsed.definitions || {};

const capitalize = str => {
  if (typeof str !== 'string') {
    return '';
  }
  return str.charAt(0).toUpperCase() + str.slice(1);
};

const parseMethodName = (url, method) => {
  return url.split('/').map((part, index) => {
    const tmp = part.split('{').join('').split('}').join('').split('.').join('')
      .split('_').map((part, index2) => index > 1 || index2 > 1 ? capitalize(part) : part).join('');
    return index > 1 ? capitalize(tmp) : tmp;
  }).join('') + capitalize(method);
};

const parseMethodUrl = (url) => {
  return url.split('{').join(':').split('}').join('');
};

const parseClassName = tags => tags.map(tag => capitalize(tag)).join('') + 'Controller';
const parseClassPath = tags => tags.map(tag => tag).join('');

const parseSchemaRef = schemaRef => {
  if (!schemaRef) {
    return 'any';
  }
  const tmp = schemaRef.split('/');
  return tmp[tmp.length - 1];
};

const parseSchema = schema => {
  if (schema.type === 'array') {
    return parseSchema(schema.items) + '[]';
  } else if (schema.type === 'string') {
    return 'string';
  } else if (schema.type === 'number' || schema.type === 'integer') {
    return 'number';
  } else {
    return parseSchemaRef(schema['$ref']);
  }
};

const isSchemaArray = schema => !!schema && schema.type === 'array';

const apisByName = {};
const apis = [];
Object.keys(paths).forEach(url => {
  const path = paths[url];
  Object.keys(path).forEach(method => {
    const endpoint = path[method];
    const tags = endpoint.tags || [];
    const parameters = endpoint.parameters || [];
    let noParameters = false;
    let noBodyParameters = true;
    let noRequestBody = false;
    if (parameters.length) {
      parameters[parameters.length - 1].last = true;
      parameters.forEach(parameter => {
        parameter.type = parseSchema(parameter.schema ? parameter.schema: parameter);
        parameter.isArray = isSchemaArray(parameter.schema ? parameter.schema: parameter);
        parameter.nullable = parameter.schema ? !!parameter.schema.nullable : !parameter.required;
        parameter.inPath = parameter.in === 'path';
        parameter.inBody = parameter.in === 'body';
        if (parameter.in === 'body') {
          noBodyParameters = false;
        }
        parameter.inQuery = parameter.in === 'query';
      });
    } else {
      noParameters = true;
    }
    const requestBody = endpoint.requestBody;
    let bodySchema = 'any';
    let jsonBody = false;
    if (requestBody) {
      const bodyContent = requestBody.content || {};
      const bodySchemas = Object.keys(bodyContent).map(requestType => {
        return { name: requestType, ...bodyContent[requestType] };
      });
      if (bodySchemas.length) {
        bodySchema = parseSchema(bodySchemas[0].schema);
        jsonBody = !!bodySchemas.find(item => item.name.indexOf('json') !== -1);
      }
    } else {
      noRequestBody = true;
    }
    const responses = endpoint.responses || {};
    const className = parseClassName(tags);
    const classPath = parseClassPath(tags);
    const name = parseMethodName(url, method);
    const processedUrl = parseMethodUrl(url);
    const status200 = responses['200'] || {};
    const content = status200.content || {};
    let schema = 'any';
    let jsonContent = false;
    const responseSchemas = Object.keys(content).map(responseType => {
      return { name: responseType, ...content[responseType] };
    });
    if (responseSchemas.length) {
      schema = parseSchema(responseSchemas[0].schema);
      jsonContent = !!responseSchemas.find(item => item.name.indexOf('json') !== -1);
    } else {
      jsonContent = !!(endpoint.produces || []).find(item => item.indexOf('json') !== -1);
    }
    if (!apisByName[className]) {
      apisByName[className] = {
        classPath,
        methods: []
      };
    }
    const isGet = method === 'get';
    const nameCaps = capitalize(name);
    apisByName[className].methods.push({
      name,
      nameCaps,
      url,
      processedUrl,
      method,
      isGet,
      parameters,
      noParameters,
      noBodyParameters,
      noRequestBody,
      jsonBody,
      bodySchema,
      jsonContent,
      schema
    });
  });
});

Object.keys(apisByName).forEach(name => {
  apis.push({
    name,
    ...apisByName[name]
  });
});

const models = [];
const types = {...definitions, ...schemas};
Object.keys(types).forEach(name => {
  const schema = types[name];
  const properties = [];
  Object.keys(schema.properties || {}).forEach(name => {
    const propertie = schema.properties[name];
    properties.push({
      name,
      ...propertie,
      type: parseSchema(propertie)
    });
  });
  models.push({
    name,
    ...schema,
    properties
  });
});

if (!fs.existsSync(args.output + '/controllers')) {
  fs.mkdirSync(args.output + '/controllers', {recursive: true});
}

apis.forEach(api => {
  const result = Mustache.render(controllerTemplate, { api, info });
  const path = args.output + '/controllers/' + api.name + '.' + args.format;
  console.log('generated', path);
  fs.writeFileSync(path, result, { flag: 'w+' });
});


if (!fs.existsSync(args.output + '/models')) {
  fs.mkdirSync(args.output + '/models', {recursive: true});
}

models.forEach(model => {
  const result = Mustache.render(modelTemplate, { model, info });
  const path = args.output + '/models/' + model.name + '.' + args.format;
  console.log('generated', path);
  fs.writeFileSync(path, result, { flag: 'w+' });
});


console.log('DONE');
