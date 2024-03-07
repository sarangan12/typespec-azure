import {
  ModelProperty,
  Namespace,
  Operation,
  Program,
  Type,
  Union,
  getDeprecationDetails,
  getDoc,
  getNamespaceFullName,
  getSummary,
  ignoreDiagnostics,
} from "@typespec/compiler";
import { HttpOperation, getHttpOperation } from "@typespec/http";
import { getAddedOnVersions, getRemovedOnVersions, getVersions } from "@typespec/versioning";
import {
  SdkBuiltInKinds,
  SdkEnumType,
  SdkModelPropertyType,
  SdkModelType,
  SdkParameter,
  SdkType,
  SdkUnionType,
} from "./interfaces.js";
import { isApiVersion } from "./public-utils.js";

/**
 *
 * @param emitterName Full emitter name
 * @returns The language of the emitter. I.e. "@azure-tools/typespec-csharp" will return "csharp"
 */
export function parseEmitterName(emitterName?: string): string {
  if (!emitterName) {
    throw new Error("No emitter name found in program");
  }
  const regex = /(?:cadl|typespec)-([^\\/]*)/;
  const match = emitterName.match(regex);
  if (!match || match.length < 2) return "none";
  const language = match[1];
  if (["typescript", "ts"].includes(language)) return "javascript";
  return language;
}

/**
 *
 * @param context
 * @param namespace If we know explicitly the namespace of the client, pass this in
 * @returns The name of the namespace
 */
export function getClientNamespaceStringHelper(
  context: TCGCContext,
  namespace?: Namespace
): string | undefined {
  let packageName = context.packageName;
  if (packageName) {
    packageName = packageName
      .replace(/-/g, ".")
      .replace(/\.([a-z])?/g, (match: string) => match.toUpperCase());
    return packageName.charAt(0).toUpperCase() + packageName.slice(1);
  }
  if (namespace) {
    return getNamespaceFullName(namespace);
  }
  return undefined;
}

/**
 *
 * @param context
 * @param type The type that we are adding api version information onto
 * @returns Whether the type is the api version parameter and the default value for the client
 */
export function updateWithApiVersionInformation(
  context: TCGCContext,
  type: ModelProperty
): {
  isApiVersionParam: boolean;
  clientDefaultValue?: unknown;
  onClient: boolean;
} {
  const isApiVersionParam = isApiVersion(context, type);
  return {
    isApiVersionParam,
    clientDefaultValue: isApiVersionParam ? context.__api_version_client_default_value : undefined,
    onClient: isApiVersionParam,
  };
}

/**
 *
 * @param context
 * @param type
 * @returns All api versions the type is available on
 */
export function getAvailableApiVersions(context: TCGCContext, type: Type): string[] {
  const apiVersions =
    context.__api_versions ||
    getVersions(context.program, type)[1]
      ?.getVersions()
      .map((x) => x.value);
  if (!apiVersions) return [];
  const addedOnVersions = getAddedOnVersions(context.program, type)?.map((x) => x.value) ?? [];
  const removedOnVersions = getRemovedOnVersions(context.program, type)?.map((x) => x.value) ?? [];
  let added: boolean = addedOnVersions.length ? false : true;
  let addedCounter = 0;
  let removeCounter = 0;
  const retval: string[] = [];
  for (const version of apiVersions) {
    if (addedCounter < addedOnVersions.length && version === addedOnVersions[addedCounter]) {
      added = true;
      addedCounter++;
    }
    if (removeCounter < removedOnVersions.length && version === removedOnVersions[removeCounter]) {
      added = false;
      removeCounter++;
    }
    if (added) retval.push(version);
  }
  return retval;
}

interface DocWrapper {
  description?: string;
  details?: string;
}

/**
 *
 * @param context
 * @param type
 * @returns Returns the description and details of a type
 */
export function getDocHelper(context: TCGCContext, type: Type): DocWrapper {
  const program = context.program;
  if (getSummary(program, type)) {
    return {
      description: getSummary(program, type),
      details: getDoc(program, type),
    };
  }
  return {
    description: getDoc(program, type),
  };
}

/**
 *
 * @param type
 * @returns A unique id for each type so we can do set comparisons
 */
export function getHashForType(type: SdkType): string {
  if (type.kind === "array" || type.kind === "dict") {
    return `${type.kind}[${getHashForType(type.valueType)}]`;
  }
  if (type.kind === "enum" || type.kind === "model" || type.kind === "enumvalue") return type.name;
  if (type.kind === "union") {
    return type.values.map((x) => getHashForType(x)).join("|");
  }
  return type.kind;
}

interface DefaultSdkTypeBase<TKind> {
  __raw: Type;
  nullable: boolean;
  deprecation?: string;
  kind: TKind;
}

/**
 * Helper function to return default values for nullable, encode etc
 * @param type
 */
export function getSdkTypeBaseHelper<TKind>(
  context: TCGCContext,
  type: Type,
  kind: TKind
): DefaultSdkTypeBase<TKind> {
  return {
    __raw: type,
    nullable: false,
    deprecation: getDeprecationDetails(context.program, type)?.message,
    kind,
  };
}

export function intOrFloat(value: number): "int32" | "float32" {
  return value.toString().indexOf(".") === -1 ? "int32" : "float32";
}

/**
 * Whether a model is an Azure.Core model or not
 * @param t
 * @returns
 */
export function isAzureCoreModel(t: Type): boolean {
  return (
    t.kind === "Model" &&
    t.namespace !== undefined &&
    ["Azure.Core", "Azure.Core.Foundations"].includes(getNamespaceFullName(t.namespace))
  );
}

export function isAcceptHeader(param: SdkModelPropertyType): boolean {
  return param.kind === "header" && param.serializedName.toLowerCase() === "accept";
}

export function isMultipartOperation(context: TCGCContext, operation?: Operation): boolean {
  if (!operation) return false;
  const httpOperation = ignoreDiagnostics(getHttpOperation(context.program, operation));
  const httpBody = httpOperation.parameters.body;
  if (httpBody && httpBody.type.kind === "Model") {
    return httpBody.contentTypes.some((x) => x.startsWith("multipart/"));
  }
  return false;
}

export function isHttpOperation(context: TCGCContext, obj: any): obj is HttpOperation {
  return !!obj && obj.kind === "Operation" && !getHttpOperation(context.program, obj)[1].length;
}
export interface TCGCContext {
  program: Program;
  emitterName: string;
  generateProtocolMethods?: boolean;
  generateConvenienceMethods?: boolean;
  filterOutCoreModels?: boolean;
  packageName?: string;
  arm?: boolean;
  modelsMap?: Map<Type, SdkModelType | SdkEnumType>;
  operationModelsMap?: Map<Operation, Map<Type, SdkModelType | SdkEnumType>>;
  generatedNames?: Set<string>;
  unionsMap?: Map<Union, SdkUnionType>;
  __api_version_parameter?: SdkParameter;
  __api_version_client_default_value?: string;
  __api_versions?: string[];
  knownScalars?: Record<string, SdkBuiltInKinds>;
}

export function createTCGCContext(program: Program): TCGCContext {
  return {
    program,
    emitterName: "__TCGC_INTERNAL__",
  };
}
