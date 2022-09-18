const mongoose = require("mongoose");

const cartValidator = require("../joi-validators/cart");

const beverageModel = require("../models/beverages-model");
const cartModel = require("../models/carts-model");
const lineItemModel = require("../models/lineItems-model");
const purchaseModel = require("../models/purchases-model");
const purchaseLineItemModel = require("../models/purchaseLineItems-model");
const userModel = require("../models/users-model");

module.exports = {
    addToCart: async (req, res) => {
        const userId = req.params.userId;
        const beverageId = req.body.beverageId;
        const quantity = req.body.quantity;

        try {

            //validation
            let errorObject = {};

            const lineItemValidationResults =
                cartValidator.addToCartValidator.validate(req.body, {
                    abortEarly: false,
                });

            if (lineItemValidationResults.error) {
                const validationError = lineItemValidationResults.error.details;

                validationError.forEach((error) => {
                    errorObject[error.context.key] = error.message;
                });

                return res.status(400).json(errorObject);
            }

            //check if line item already exists
            let lineItemExists = await lineItemModel.findOne({
                user: mongoose.Types.ObjectId(`${userId}`),
                product: mongoose.Types.ObjectId(`${beverageId}`),
            });

            //if exists, update quantity instead
            if (lineItemExists) {
                await lineItemModel.findByIdAndUpdate(lineItemExists._id, {
                    $inc: {
                        quantity,
                    },
                });

                //no stock reservation in this iteration of cart
                await beverageModel.findByIdAndUpdate(lineItemExists.product, {
                    $inc: {
                        stock: -quantity,
                    },
                });

                // check if cart exists
                const userCart = await cartModel.findOneAndUpdate(
                    { user: mongoose.Types.ObjectId(`${userId}`) },
                    {
                        //addtoSet only adds if the value is not already present
                        $addToSet: {
                            lineItems: lineItemExists._id,
                        },
                    }
                );

                if (!userCart) {
                    const newCart = await cartModel.create({
                        user: mongoose.Types.ObjectId(`${userId}`),
                    });
    
                    await cartModel.findByIdAndUpdate(newCart._id, {
                        $push: {
                            lineItems: lineItemExists._id,
                        },
                    });
                }

                return res.status(200).json({ message: "item added to cart" });

            }

            //create line item
            let lineItem = await lineItemModel.create({
                user: mongoose.Types.ObjectId(`${userId}`),
                product: mongoose.Types.ObjectId(`${beverageId}`),
                quantity,
            });


            //deduct directly from stock. no reservation
            await beverageModel.findByIdAndUpdate(lineItem.product, {
                $inc: {
                    stock: -quantity,
                },
            });

            //check if cart exists
            const userCart = await cartModel.findAndUpdate(
                { user: mongoose.Types.ObjectId(`${userId}`) }
            );

            if (!userCart) {
                const newCart = await cartModel.create({
                    user: mongoose.Types.ObjectId(`${userId}`),
                });

                await cartModel.findByIdAndUpdate(newCart._id, {
                    $push: {
                        lineItems: lineItem._id,
                    },
                });
            }

            await cartModel.findByIdAndUpdate(userCart._id, {
                $addToSet: {
                    lineItems: lineItem._id
                }
            })

            return res.status(200).json({ message: "item added to cart" });
        } catch (error) {
            console.log(error);
            return res
                .status(500)
                .json({ message: "unable to add item to cart!" });
        }
    },

    //edit item in cart
    updateCart: async (req, res) => {
        const lineItemId = req.params.lineItemId;
        const quantity = req.body.quantity;

        //validation
        let errorObject = {};

        const lineItemValidationResults =
            cartValidator.updateCartValidator.validate(req.body, {
                abortEarly: false,
            });

        if (lineItemValidationResults.error) {
            const validationError = lineItemValidationResults.error.details;

            validationError.forEach((error) => {
                errorObject[error.context.key] = error.message;
            });

            return res.status(400).json(errorObject);
        }

        try {
            //populate with product price
            const lineItem = await lineItemModel.findById(lineItemId).populate({
                path: "product",
                select: ["stock"],
            });

            if (!lineItem) {
                return res.status(404).json({ message: "line item not found" });
            }

            let quantityStockDifference = quantity - lineItem.quantity;

            console.log(quantityStockDifference);

            await beverageModel.findByIdAndUpdate(lineItem.product, {
                $inc: {
                    stock: -quantityStockDifference,
                },
            });

            await lineItemModel.findByIdAndUpdate(lineItem, {
                quantity,
            });

            res.status(200).json({ message: "cart updated" });
        } catch (error) {
            console.log(error);
            res.status(500).json({ message: "unable to update cart!" });
        }
    },

    //remove from cart
    removeFromCart: async (req, res) => {
        const userId = req.params.userId;
        const lineItemId = req.params.lineItemId;

        try {
            const lineItemToDelete = await lineItemModel.findById(lineItemId);

            //add stock back to stock count
            await beverageModel.findByIdAndUpdate(lineItemToDelete.product, {
                $inc: {
                    stock: lineItemToDelete.quantity,
                },
            });

            //remove from lineItem collection
            await lineItemModel.findByIdAndDelete(lineItemId);

            if (!lineItemToDelete) {
                return res.status(404).json({ message: "line item not found" });
            }

            //remove lineItemId from cart array
            await userModel.findByIdAndUpdate(userId, {
                $pull: {
                    cart: mongoose.Types.ObjectId(`${lineItemId}`),
                },
            });

            res.status(200).json({ message: "Item removed from cart!" });
        } catch (error) {
            console.log(error);
            res.status(500).json({ message: "unable remove item from cart!" });
        }
    },

    //show cart
    showCart: async (req, res) => {
        const userId = req.params.userId;

        try {
            const userCart = await userModel
                .findById(userId, "-__v -userType -password")
                .populate([
                    {
                        path: "cart",
                        select: ["_id", "quantity", "totalSum"],
                        populate: {
                            path: "product",
                            select: [
                                "name",
                                "brandName",
                                "price",
                                "stock",
                                "spec",
                                "img",
                            ],
                        },
                    },
                ]);

            if (!userCart) {
                res.status(404).json({ message: "cart not found" });
            }
            res.status(200).json(userCart);
            console.log(userCart);
        } catch (error) {
            res.status(500).json({ message: "unable to load cart" });
        }
    },

    purchase: async (req, res) => {
        const userId = req.params.userId;

        // //copy cartLineItems to purchaseLineItems
        // await lineItemModel.aggregate([ { $match: {user:  mongoose.Types.ObjectId(`${userId}`) }},
        // { $out: "purchaselineitems" }]);

        // await purchaseModel.create({
        //     user: mongoose.Types.ObjectId(`${userId}`),
        //     $set: {
        //         purchases: [...purchaseLineItems]
        //     }
        // })

        // res.json(purchaseLineItems)

        //update beverage stock count
        // await beverageModel
    },
};
