import { graphql } from "./graphql.js";

const query = `

query {

  shop {

    name

    myshopifyDomain

  }

}

`;

const result = await graphql(query);

console.log(result);
